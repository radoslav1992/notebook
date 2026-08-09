/**
 * Fake Generative Language API, just faithful enough in shape to drive the app:
 * embeddings, SSE generation with [n] markers, JSON-schema output, and TTS audio.
 * Records every request so the test can assert on what the app actually sent.
 */
import { createServer } from 'node:http';

const PORT = Number(process.env.MOCK_PORT || 8788);
const calls = [];
let docCounter = 0;

function embedFor(text, dims) {
  // Deterministic pseudo-embedding: token hashing into buckets, so semantically
  // overlapping strings land near each other and retrieval is meaningfully ordered.
  const v = new Float64Array(dims);
  const words = String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const w of words) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    v[Math.abs(h) % dims] += 1;
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}

function pcmTone(seconds, rate = 24000) {
  const samples = Math.round(seconds * rate);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(6000 * Math.sin((2 * Math.PI * 220 * i) / rate)), i * 2);
  }
  return buf;
}

const server = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { _raw: raw.slice(0, 2000) };
  }
  const url = req.url ?? '';
  calls.push({ url, method: req.method, body, apiKey: req.headers['x-goog-api-key'] });

  const send = (code, obj) => {
    const s = JSON.stringify(obj);
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(s);
  };

  if (url.startsWith('/__calls')) return send(200, { calls });
  if (url.startsWith('/__reset')) {
    calls.length = 0;
    return send(200, { ok: true });
  }

  // ── File Search stores (Google's managed RAG) ────────────────────────────
  if (req.headers['x-goog-api-key'] === 'test-key') {
    if (url === '/v1beta/fileSearchStores' && req.method === 'POST') {
      return send(200, { name: 'fileSearchStores/store-1', displayName: body.displayName });
    }
    if (url.includes(':uploadToFileSearchStore')) {
      docCounter += 1;
      return send(200, {
        name: `operations/op-${docCounter}`,
        done: true,
        response: { document: { name: `fileSearchStores/store-1/documents/doc-${docCounter}` } },
      });
    }
    if (url.startsWith('/v1beta/fileSearchStores/') && req.method === 'DELETE') {
      return send(200, {});
    }
  }

  if (req.headers['x-goog-api-key'] !== 'test-key') {
    return send(401, { error: { message: 'API key not valid', status: 'UNAUTHENTICATED' } });
  }

  // ── embeddings ───────────────────────────────────────────────────────────
  if (url.includes(':batchEmbedContents')) {
    const reqs = body.requests ?? [];
    const dims = reqs[0]?.outputDimensionality ?? 1536;
    return send(200, {
      embeddings: reqs.map((r) => ({
        values: embedFor(r.content?.parts?.map((p) => p.text).join(' ') ?? '', dims),
      })),
    });
  }
  if (url.includes(':embedContent')) {
    const dims = body.outputDimensionality ?? 1536;
    return send(200, {
      embedding: { values: embedFor(body.content?.parts?.map((p) => p.text).join(' ') ?? '', dims) },
    });
  }

  // ── TTS ──────────────────────────────────────────────────────────────────
  if (url.includes('-tts:generateContent')) {
    const text = body.contents?.[0]?.parts?.map((p) => p.text).join(' ') ?? '';
    const seconds = Math.max(0.4, Math.min(6, text.length / 900));
    return send(200, {
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: 'audio/L16;codec=pcm;rate=24000',
                  data: pcmTone(seconds).toString('base64'),
                },
              },
            ],
          },
        },
      ],
    });
  }

  // ── streaming generation ─────────────────────────────────────────────────
  if (url.includes(':streamGenerateContent')) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const prompt = body.contents?.at(-1)?.parts?.map((p) => p.text).join(' ') ?? '';
    // Cite whichever passage numbers were actually offered, so citation
    // mapping is exercised with real indices.
    const offered = [...prompt.matchAll(/^\[(\d+)\] Източник/gm)].map((m) => m[1]);
    const a = offered[0] ?? '1';
    const b = offered[1] ?? a;
    const pieces = [
      'До 2030 ЕС се ангажира с намаление ',
      'на нетните емисии с поне 55% ',
      `спрямо 1990 г. [${a}] `,
      'Финансирането минава основно ',
      `през Фонда за модернизация. [${b}]`,
    ];
    for (const text of pieces) {
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 12));
    }
    res.end();
    return;
  }

  // ── non-streaming generation (studio notes, mindmap, naming) ─────────────
  if (url.includes(':generateContent')) {
    const fileSearch = (body.tools ?? []).some((t) => t.fileSearch);
    if (fileSearch) {
      // Shape mirrors groundingMetadata from the File Search tool. The passage
      // text keeps the "[стр. N]" prefix the app writes at upload time.
      return send(200, {
        candidates: [
          {
            content: {
              parts: [
                {
                  text: 'До 2030 ЕС се ангажира с намаление на нетните емисии с поне 55%. Финансирането минава през Фонда за модернизация.',
                },
              ],
            },
            groundingMetadata: {
              groundingChunks: [
                { retrievedContext: { title: '1 · Зелена сделка (преименуван).pdf', text: '[стр. 1] Page one discusses the 2050 climate neutrality target.' } },
                { retrievedContext: { title: '4 · Лекция 4 (преименуван).docx', text: '[раздел „Финансиране“] Средствата идват през Фонда за модернизация.' } },
              ],
            },
          },
        ],
      });
    }
    const wantsJson = body.generationConfig?.responseMimeType === 'application/json';
    const schema = body.generationConfig?.responseSchema;
    const prompt = body.contents?.at(-1)?.parts?.map((p) => p.text).join(' ') ?? '';
    let text;

    if (wantsJson && schema?.properties?.nodes) {
      text = JSON.stringify({
        center: 'Климатична политика на ЕС',
        nodes: [
          { label: 'Въглеродни квоти', hint: 'Схемата за търговия с емисии.' },
          { label: 'Зелена сделка', hint: 'Рамката за 2050.' },
          { label: 'Енергиен микс', hint: 'Дял на лигнита.' },
          { label: 'Транспорт', hint: 'Емисии от превози.' },
          { label: 'Финансиране', hint: 'Фонд за модернизация.' },
          { label: 'Ефект върху България', hint: 'Маришки басейн.' },
        ],
      });
    } else if (wantsJson && schema?.properties?.emoji) {
      text = JSON.stringify({
        title: 'Климатична политика на ЕС',
        emoji: '🌍',
        blurb: 'Регламенти, цели и ефекти върху българската енергетика.',
      });
    } else if (wantsJson && schema?.properties?.segments) {
      text = JSON.stringify({
        title: 'Дебат в ЕП',
        segments: [
          { start: '0:00', text: 'Откриване на дебата за климатичните цели и техните срокове.' },
          { start: '1:30', text: 'Спор за 2035 срещу 2038 като година за затваряне на лигнита.' },
        ],
      });
    } else if (/сценарий за разговорен подкаст/.test(prompt)) {
      const lines = [];
      for (let i = 0; i < 12; i++) {
        lines.push(`Ния: Реплика ${i} — питам за числата и какво точно казват източниците.`);
        lines.push(`Стефан: Реплика ${i} — отговарям и посочвам къде се разминават документите.`);
      }
      text = lines.join('\n');
    } else {
      text = '## Основни понятия\n\n- **Зелена сделка** — рамката на ЕС (Източник 1, стр. 12)\n\n## Какво остава неясно\n\nРазпределението на Фонда за модернизация.';
    }

    return send(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] });
  }

  return send(404, { error: { message: 'unhandled: ' + url } });
});

server.listen(PORT, '127.0.0.1', () => console.log(`mock gemini on ${PORT}`));
