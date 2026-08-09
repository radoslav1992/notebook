# Notebook — a NotebookLM clone

A source-grounded research workspace: upload documents, ask questions, and get answers
that cite the exact passage they came from — plus study guides, briefing docs, FAQs,
timelines, mind maps, and multi-speaker audio overviews.

Built with **Astro** (SSR) and deployed to **Cloudflare Workers**. Retrieval, generation
and speech all run on Google's **Gemini API**; Cloudflare provides storage and hosting.

---

## How it works

```
Browser ──► Astro SSR on Cloudflare Workers
              │
              ├── D1        notebooks, sources, chat, notes, audio jobs
              ├── R2        original uploads + rendered .wav audio
              └── Gemini API
                     ├── File Search store   chunking + embedding + retrieval + citations
                     ├── generateContent     grounded answers, Studio artifacts
                     └── TTS models          multi-speaker audio overviews
```

**Retrieval is Gemini's File Search tool**, one managed store per notebook. Uploading a
source pushes the raw bytes to the store — Gemini extracts, chunks and embeds them, so
PDFs and DOCX never have to be parsed inside the Worker. Each document carries a
`source_id` in its custom metadata, which becomes a retrieval metadata filter when the
user narrows the selection in the Sources panel.

Answers stream back over SSE. Gemini's `groundingMetadata` is mapped to numbered
citations (`src/lib/rag.ts`), spliced into the answer at the reported byte offsets, and
rendered as clickable chips that open the source at the cited passage.

**Audio overviews** are two steps: a grounded script generation pass, then multi-speaker
TTS. The returned PCM is concatenated, wrapped in a WAV header (`src/lib/audio.ts`) and
stored in R2, streamed back with range support so the player can seek.

### Layout

```
src/
  lib/
    gemini.ts     REST client — File Search, generateContent, SSE streaming, TTS
    rag.ts        tool construction, citation mapping, answer annotation
    ingest.ts     upload → index → enrich pipeline; URL + YouTube handling
    audio.ts      script prompts, WAV encoding, the audio job
    studio.ts     prompts for study guide / briefing / FAQ / timeline / mind map
    db.ts         D1 queries and row mapping
    session.ts    signed anonymous owner cookie
    env.ts        binding + secret access
    client.ts     typed browser API client
  components/     React islands — three-pane workspace, modals, markdown renderer
  pages/
    index.astro           notebook list
    notebook/[id].astro   the workspace
    api/                  JSON + SSE endpoints
```

---

## Setup

### 1. Install

```bash
npm install
```

### 2. Create the Cloudflare resources

```bash
npx wrangler d1 create notebooklm
npx wrangler r2 bucket create notebooklm-media
npx wrangler kv namespace create SESSION
```

Paste the returned `database_id` and KV `id` into `wrangler.jsonc`, then regenerate types:

```bash
npm run typegen
```

### 3. Apply the database schema

```bash
npm run db:local     # local dev
npm run db:remote    # deployed Worker
```

### 4. Provide the secrets

Locally:

```bash
cp .dev.vars.example .dev.vars
```

Fill in:

- `GEMINI_API_KEY` — from [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
- `SESSION_SECRET` — any long random string

In production:

```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put SESSION_SECRET
```

### 5. Run

```bash
npm run dev        # http://localhost:4321
npm run deploy     # build + publish to Cloudflare
```

`npm run preview` builds and serves the real Worker bundle locally via `wrangler dev`.

---

## Configuration

Models are set in `wrangler.jsonc` under `vars`, so you can move to a newer model
without touching code:

| Variable             | Default                        | Used for                          |
| -------------------- | ------------------------------ | --------------------------------- |
| `GEMINI_CHAT_MODEL`  | `gemini-2.5-flash`             | Chat, Studio artifacts, summaries |
| `GEMINI_TTS_MODEL`   | `gemini-2.5-flash-preview-tts` | Audio overviews                   |

Other knobs:

- `src/lib/constants.ts` — per-file upload limit (20 MB)
- `src/lib/studio.ts` — the prompt for every generated document
- `src/lib/audio.ts` — audio formats, host voices, script direction
- `src/lib/rag.ts` — the grounding system prompt
- `src/styles/global.css` — the whole design system, as two blocks of colour tokens

### Theming

Every colour routes through CSS custom properties in `:root` (light) and the
`data-theme="dark"` / `prefers-color-scheme: dark` blocks. Restyling to a different
design means editing those two token blocks — components reference semantic names
(`bg-surface`, `text-muted`, `border-line`) and never raw colours.

---

## Sources

| Type            | Handling                                                                 |
| --------------- | ------------------------------------------------------------------------ |
| PDF, DOCX       | Uploaded as-is; Gemini extracts and chunks server-side                    |
| TXT, MD, CSV, JSON | Uploaded as text                                                      |
| Web page        | Fetched, stripped to text, then indexed                                   |
| YouTube         | Gemini reads the video and produces a transcript, which is then indexed   |
| Pasted text     | Indexed directly                                                         |

---

## Notes and limits

- **Auth is anonymous.** Each browser gets a signed owner cookie that scopes its
  notebooks (`src/lib/session.ts`). To add real accounts, replace `getOwnerId` with a
  lookup against your identity provider — every query is already scoped by `owner_id`.
- **Background work uses `waitUntil`.** Indexing and audio rendering continue after the
  response is sent, and the client polls `/api/notebooks/:id/state`. A long audio
  overview can exceed a Worker's post-response budget; for heavier workloads, move
  `runAudioJob` behind Cloudflare Queues or a Durable Object and keep the same D1 job
  rows and polling contract.
- **Costs land on the Gemini API** — indexing, retrieval, generation and TTS are all
  billed there. File Search stores persist until deleted; deleting a notebook deletes
  its store.
