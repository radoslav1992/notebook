import * as db from './db';
import type { AppContext } from './env';
import {
  GeminiError,
  createStore,
  generateText,
  uploadToStore,
  waitForOperation,
} from './gemini';
import { newId } from './ids';
import { fileSearchTool } from './rag';
import type { SourceKind } from './types';

/** File Search accepts these directly — anything else is sent as plain text. */
const PASSTHROUGH_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/json',
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
]);

export { MAX_SOURCE_BYTES } from './constants';

export function normalizeMime(name: string, declared?: string | null): string {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    txt: 'text/plain',
    md: 'text/markdown',
    markdown: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    html: 'text/html',
    htm: 'text/html',
  };
  if (byExt[ext]) return byExt[ext];
  if (declared && PASSTHROUGH_MIME.has(declared)) return declared;
  // Source code, logs, anything textual: File Search indexes it as text.
  return 'text/plain';
}

/** Lazily create the notebook's File Search store on first source. */
export async function ensureStore(
  app: AppContext,
  notebook: { id: string; title: string; storeName: string | null },
): Promise<string> {
  if (notebook.storeName) return notebook.storeName;
  const store = await createStore(app.gemini, `${notebook.title} (${notebook.id})`);
  await db.updateNotebook(app.env.DB, notebook.id, { storeName: store.name });
  return store.name;
}

/* ------------------------------ text extraction --------------------------- */

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function htmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const t = m?.[1]?.trim();
  return t ? htmlToText(t).slice(0, 160) : null;
}

export function isYouTube(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
}

export async function fetchWebPage(
  url: string,
): Promise<{ title: string; text: string }> {
  const res = await fetch(url, {
    headers: {
      // Some sites serve a JS shell to unknown agents; ask for HTML explicitly.
      accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8',
      'user-agent': 'Mozilla/5.0 (compatible; NotebookClone/1.0; +https://workers.dev)',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Could not fetch that URL (HTTP ${res.status})`);

  const contentType = res.headers.get('content-type') ?? '';
  const body = await res.text();
  if (contentType.includes('html')) {
    const text = htmlToText(body);
    if (text.length < 40) throw new Error('That page had no readable text');
    return { title: htmlTitle(body) ?? new URL(url).hostname, text };
  }
  return { title: new URL(url).pathname.split('/').pop() || new URL(url).hostname, text: body };
}

/**
 * YouTube pages are a JS shell, so scraping them yields nothing. Gemini can read
 * a public YouTube URL directly, so we have it produce a full transcript-style
 * document and index that text instead.
 */
export async function transcribeYouTube(
  app: AppContext,
  url: string,
): Promise<{ title: string; text: string }> {
  const text = await generateText(app.gemini, {
    contents: [
      {
        role: 'user',
        parts: [
          { fileData: { fileUri: url } },
          {
            text: `Produce a complete, faithful text record of this video so it can be used as a research source.

Format exactly like this:
TITLE: <the video's title>
---
<the full spoken content, in order, as clean prose paragraphs. Include every substantive point, example, number and name. Prefix major sections with a timestamp like [12:34]. Do not summarize, editorialize, or omit content.>`,
          },
        ],
      },
    ],
    temperature: 0.1,
    maxOutputTokens: 32768,
  });

  const match = /^TITLE:\s*(.+?)\s*\n-{3,}\n([\s\S]+)$/.exec(text.trim());
  if (match) return { title: match[1].slice(0, 200), text: match[2].trim() };
  return { title: 'YouTube video', text };
}

/* --------------------------------- indexing ------------------------------- */

export interface IngestInput {
  notebookId: string;
  storeName: string;
  title: string;
  kind: SourceKind;
  mimeType: string;
  bytes: ArrayBuffer;
  originUrl?: string | null;
  /** Plain-text preview shown in the source viewer, when we have one. */
  preview?: string | null;
  r2Key?: string | null;
}

/**
 * Creates the source row immediately (so the UI can show it as "indexing"),
 * then finishes the upload + enrichment in the background.
 */
export async function ingestSource(app: AppContext, input: IngestInput): Promise<string> {
  const sourceId = newId('s');

  await db.insertSource(app.env.DB, {
    id: sourceId,
    notebookId: input.notebookId,
    title: input.title,
    kind: input.kind,
    mimeType: input.mimeType,
    sizeBytes: input.bytes.byteLength,
    r2Key: input.r2Key ?? null,
    originUrl: input.originUrl ?? null,
    preview: input.preview ? input.preview.slice(0, 200_000) : null,
  });

  app.ctx.waitUntil(indexSource(app, sourceId, input));
  return sourceId;
}

async function indexSource(app: AppContext, sourceId: string, input: IngestInput): Promise<void> {
  try {
    const op = await uploadToStore(app.gemini, {
      storeName: input.storeName,
      displayName: input.title,
      mimeType: input.mimeType,
      bytes: input.bytes,
      customMetadata: { source_id: sourceId, notebook_id: input.notebookId },
    });

    await db.updateSource(app.env.DB, sourceId, { operationName: op.name });

    const done = await waitForOperation(app.gemini, op.name);
    const docName =
      (done.response?.name as string | undefined) ??
      ((done.response?.document as { name?: string } | undefined)?.name ?? null);

    await db.updateSource(app.env.DB, sourceId, { status: 'ready', docName, error: null });
    await enrichSource(app, sourceId, input);
  } catch (err) {
    const message =
      err instanceof GeminiError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Indexing failed';
    await db.updateSource(app.env.DB, sourceId, { status: 'error', error: message.slice(0, 500) });
  }
}

/** Ask the model for the one-line summary and topic chips NotebookLM shows. */
async function enrichSource(app: AppContext, sourceId: string, input: IngestInput): Promise<void> {
  try {
    const raw = await generateText(app.gemini, {
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Read the source titled "${input.title}" and describe it.

Return JSON only:
{"summary": "<2-3 sentences on what this source contains and what it is useful for>", "topics": ["<3-6 short key topic phrases, 1-4 words each>"]}`,
            },
          ],
        },
      ],
      // Scoped to just this source, so the blurb describes it and not its neighbours.
      tools: fileSearchTool(input.storeName, { sourceIds: [sourceId] }),
      temperature: 0.2,
      maxOutputTokens: 1024,
    });

    const json = extractJson<{ summary?: string; topics?: string[] }>(raw);
    if (json?.summary) {
      await db.updateSource(app.env.DB, sourceId, {
        summary: json.summary.slice(0, 2000),
        topics: (json.topics ?? []).slice(0, 8).map((t) => String(t).slice(0, 60)),
      });
    }
  } catch {
    // Enrichment is cosmetic — a source without a blurb is still fully usable.
  }
}

/** Models sometimes wrap JSON in prose or a fence; dig it out either way. */
export function extractJson<T>(raw: string): T | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidates = [fenced?.[1], raw].filter(Boolean) as string[];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    const start = trimmed.search(/[[{]/);
    if (start === -1) continue;
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (end <= start) continue;
    try {
      return JSON.parse(trimmed.slice(start, end + 1)) as T;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
