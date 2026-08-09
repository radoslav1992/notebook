import { Gemini, groundingChunksOf, textOf } from './gemini';
import { getChunksByIds, getChunksForSources } from './db';
import { EMBED_DIMENSIONS } from './constants';
import { answerSystem } from './prompts';
import type { Citation, Source } from './types';

/** Един извлечен пасаж, готов да влезе в контекста на модела. */
export interface Retrieved {
  /** 1-базиран номер, който моделът цитира като [3]. */
  index: number;
  sourceId: string | null;
  sourceOrdinal: number;
  sourceName: string;
  locator: string;
  text: string;
  score: number;
}

export interface RagContext {
  db: D1Database;
  vectorize: VectorizeIndex;
  gemini: Gemini;
  backend: 'vectorize' | 'gemini';
  storeName?: string | null;
  language: string;
}

const TOP_K = 10;
const OVERFETCH = 30;

/* ── Извличане ───────────────────────────────────────────────────────────── */

export async function retrieve(
  ctx: RagContext,
  notebookId: string,
  query: string,
  sources: Source[],
): Promise<Retrieved[]> {
  if (sources.length === 0) return [];

  const [vector] = await ctx.gemini.embed([query], 'RETRIEVAL_QUERY', EMBED_DIMENSIONS);
  if (!vector) return [];

  const allowed = new Set(sources.map((s) => s.id));
  const filter: Record<string, unknown> = { notebookId: { $eq: notebookId } };
  // Стесняваме още в индекса, когато част от източниците са изключени.
  if (sources.length <= 20) {
    filter.sourceId = { $in: sources.map((s) => s.id) };
  }

  let matches: { id: string; score: number }[] = [];
  try {
    const res = await ctx.vectorize.query(vector, {
      topK: OVERFETCH,
      filter: filter as VectorizeVectorMetadataFilter,
      returnValues: false,
      returnMetadata: 'none',
    });
    matches = res.matches.map((m) => ({ id: m.id, score: m.score }));
  } catch {
    // Ако филтърът не мине (липсващ индекс по метаданни), търсим широко и
    // отсяваме след това.
    const res = await ctx.vectorize.query(vector, { topK: OVERFETCH * 2, returnMetadata: 'none' });
    matches = res.matches.map((m) => ({ id: m.id, score: m.score }));
  }

  if (matches.length === 0) return [];

  const rows = await getChunksByIds(
    ctx.db,
    matches.map((m) => m.id),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const byOrdinal = new Map(sources.map((s) => [s.id, s]));

  const kept: Retrieved[] = [];
  for (const m of matches) {
    const row = byId.get(m.id);
    if (!row) continue;
    if (row.notebook_id !== notebookId) continue;
    if (!allowed.has(row.source_id)) continue;
    const source = byOrdinal.get(row.source_id);
    if (!source) continue;
    kept.push({
      index: kept.length + 1,
      sourceId: source.id,
      sourceOrdinal: source.ordinal,
      sourceName: source.name,
      locator: row.locator,
      text: row.text,
      score: m.score,
    });
    if (kept.length >= TOP_K) break;
  }
  return kept;
}

/** Пасажи за задачи над целия материал (подкаст, мисловна карта, ръководство). */
export async function readAll(
  ctx: RagContext,
  sources: Source[],
  maxChars = 120_000,
): Promise<Retrieved[]> {
  const rows = await getChunksForSources(
    ctx.db,
    sources.map((s) => s.id),
  );
  const byId = new Map(sources.map((s) => [s.id, s]));
  const out: Retrieved[] = [];
  let chars = 0;
  for (const row of rows) {
    const source = byId.get(row.source_id);
    if (!source) continue;
    if (chars + row.text.length > maxChars) break;
    chars += row.text.length;
    out.push({
      index: out.length + 1,
      sourceId: source.id,
      sourceOrdinal: source.ordinal,
      sourceName: source.name,
      locator: row.locator,
      text: row.text,
      score: 1,
    });
  }
  return out;
}

/* ── Контекст за подсказката ─────────────────────────────────────────────── */

export function buildContextBlock(passages: Retrieved[]): string {
  return passages
    .map(
      (p) =>
        `[${p.index}] Източник ${p.sourceOrdinal} · ${p.sourceName}${p.locator ? ` · ${p.locator}` : ''}\n${p.text}`,
    )
    .join('\n\n---\n\n');
}

export function shortName(name: string, max = 28): string {
  const stripped = name.replace(/\.(pdf|docx?|txt|md|mp3|m4a|wav|ogg|flac)$/i, '');
  return stripped.length <= max ? stripped : `${stripped.slice(0, max - 1)}…`;
}

/** „1 · Зелена сделка, стр. 12“ — точно както е в дизайна. */
export function citationLabel(p: Retrieved): string {
  const base = `${p.sourceOrdinal} · ${shortName(p.sourceName)}`;
  return p.locator ? `${base}, ${p.locator}` : base;
}

/**
 * Превръща [3]-маркерите в отговора в подредени цитати и връща изчистен текст.
 * Показваме само реално използваните пасажи — иначе чиповете под отговора
 * престават да значат нещо.
 */
export function extractCitations(
  answer: string,
  passages: Retrieved[],
): { text: string; citations: Citation[] } {
  const byIndex = new Map(passages.map((p) => [p.index, p]));
  const used: number[] = [];

  for (const m of answer.matchAll(/\[(\d+(?:\s*,\s*\d+)*)\]/g)) {
    for (const part of m[1]!.split(',')) {
      const n = Number(part.trim());
      if (byIndex.has(n) && !used.includes(n)) used.push(n);
    }
  }

  const citations: Citation[] = used.map((n, i) => {
    const p = byIndex.get(n)!;
    return {
      ordinal: i + 1,
      sourceId: p.sourceId,
      label: citationLabel(p),
      locator: p.locator,
      snippet: p.text.slice(0, 400),
    };
  });

  return { text: stripCitationMarkers(answer), citations };
}

/** Маркерите са за нас, не за читателя — дизайнът ги показва като чипове. */
export function stripCitationMarkers(text: string): string {
  return text
    .replace(/\s*\[(\d+(?:\s*,\s*\d+)*)\]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

/* ── Отговаряне ──────────────────────────────────────────────────────────── */

export interface AnswerStream {
  /** Парчета видим текст (маркерите вече са изчистени). */
  chunks: AsyncGenerator<string>;
  /** Изпълнява се след като потокът приключи. */
  finish: () => { text: string; citations: Citation[] };
}

/**
 * Стриймва отговор по избраните източници.
 *
 * При backend='vectorize' пасажите се търсят предварително и се подават в
 * подсказката — цитатите излизат точни до страница. При backend='gemini'
 * се ползва инструментът File Search и цитатите идват от groundingMetadata.
 */
export async function* answerStream(
  ctx: RagContext,
  input: {
    notebookId: string;
    question: string;
    sources: Source[];
    history: { role: 'user' | 'ai'; text: string }[];
    model?: string;
  },
): AsyncGenerator<
  | { type: 'passages'; count: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; citations: Citation[] }
> {
  if (input.sources.length === 0) {
    const text =
      'Няма избрани източници. Отбележи поне един отляво или добави нов, за да мога да отговоря само по него.';
    yield { type: 'delta', text };
    yield { type: 'done', text, citations: [] };
    return;
  }

  const history = input.history.slice(-8).map((m) => ({
    role: m.role === 'ai' ? ('model' as const) : ('user' as const),
    parts: [{ text: m.text }],
  }));

  if (ctx.backend === 'gemini' && ctx.storeName) {
    yield* answerWithFileSearch(ctx, input, history);
    return;
  }

  const passages = await retrieve(ctx, input.notebookId, input.question, input.sources);
  yield { type: 'passages', count: passages.length };

  if (passages.length === 0) {
    const text =
      'В избраните източници не намирам нищо по този въпрос. Провери дали източниците са обработени докрай, или го задай с други думи.';
    yield { type: 'delta', text };
    yield { type: 'done', text, citations: [] };
    return;
  }

  const prompt = `Пасажи от източниците:\n\n${buildContextBlock(passages)}\n\n---\n\nВъпрос: ${input.question}`;

  let raw = '';
  let emitted = 0;
  for await (const part of ctx.gemini.stream({
    model: input.model,
    contents: [...history, { role: 'user', parts: [{ text: prompt }] }],
    systemInstruction: answerSystem(ctx.language),
    config: { temperature: 0.35, maxOutputTokens: 4096 },
  })) {
    if (!part.text) continue;
    raw += part.text;
    // Задържаме края, докато е възможно да е недописан маркер „[1“.
    const safeUpTo = safeBoundary(raw);
    if (safeUpTo > emitted) {
      const visible = stripCitationMarkers(raw.slice(0, safeUpTo));
      const already = stripCitationMarkers(raw.slice(0, emitted));
      const delta = visible.slice(already.length);
      emitted = safeUpTo;
      if (delta) yield { type: 'delta', text: delta };
    }
  }

  const final = extractCitations(raw, passages);
  const alreadyShown = stripCitationMarkers(raw.slice(0, emitted));
  const tail = final.text.slice(alreadyShown.length);
  if (tail) yield { type: 'delta', text: tail };
  yield { type: 'done', text: final.text, citations: final.citations };
}

/** Индекс, до който текстът със сигурност не съдържа незавършен маркер. */
function safeBoundary(raw: string): number {
  const open = raw.lastIndexOf('[');
  if (open < 0) return raw.length;
  const closed = raw.indexOf(']', open);
  if (closed >= 0) return raw.length;
  return /^\[\d*(\s*,\s*\d*)*$/.test(raw.slice(open)) ? open : raw.length;
}

/* ── Вариант с File Search на Google ─────────────────────────────────────── */

async function* answerWithFileSearch(
  ctx: RagContext,
  input: {
    notebookId: string;
    question: string;
    sources: Source[];
    model?: string;
  },
  history: { role: 'user' | 'model'; parts: { text: string }[] }[],
): AsyncGenerator<
  | { type: 'passages'; count: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; citations: Citation[] }
> {
  const tool = Gemini.fileSearchTool([ctx.storeName!]);
  const res = await ctx.gemini.generate({
    model: input.model,
    contents: [...history, { role: 'user', parts: [{ text: input.question }] }],
    systemInstruction: answerSystem(ctx.language),
    tools: [tool],
    config: { temperature: 0.35, maxOutputTokens: 4096 },
  });

  const text = textOf(res);
  const grounding = groundingChunksOf(res);
  yield { type: 'passages', count: grounding.length };

  const citations: Citation[] = [];
  const seen = new Set<string>();

  for (const g of grounding) {
    const title = g.retrievedContext?.title ?? '';
    const source = matchSource(title, input.sources);
    // При качването пасажите носят мястото си като „[стр. 12]“ в началото.
    const locator = /\[([^\]]{1,24})\]/.exec(g.retrievedContext?.text ?? '')?.[1] ?? '';
    const label = source
      ? `${source.ordinal} · ${shortName(source.name)}${locator ? `, ${locator}` : ''}`
      : `${shortName(title.replace(/^\d+\s*·\s*/, '') || 'източник')}${locator ? `, ${locator}` : ''}`;
    if (seen.has(label)) continue;
    seen.add(label);
    citations.push({
      ordinal: citations.length + 1,
      sourceId: source?.id ?? null,
      label,
      locator,
      snippet: (g.retrievedContext?.text ?? '').slice(0, 400),
    });
  }

  const clean = stripCitationMarkers(text);
  yield { type: 'delta', text: clean };
  yield { type: 'done', text: clean, citations };
}

/**
 * Свързва `title` от groundingMetadata обратно с наш източник.
 * При качване слагаме „N · име“, така че номерът е първият и най-сигурен път;
 * останалите проби покриват случая, в който Google върне само името.
 */
function matchSource(title: string, sources: Source[]): Source | undefined {
  const trimmed = title.trim();
  if (!trimmed) return undefined;

  const numbered = /^(\d+)\s*·\s*(.*)$/.exec(trimmed);
  if (numbered) {
    const byOrdinal = sources.find((s) => s.ordinal === Number(numbered[1]));
    if (byOrdinal) return byOrdinal;
  }

  const bare = (numbered?.[2] ?? trimmed).trim();
  return (
    sources.find((s) => s.name === bare) ??
    sources.find((s) => s.name.toLowerCase() === bare.toLowerCase()) ??
    sources.find((s) => shortName(s.name).toLowerCase() === shortName(bare).toLowerCase())
  );
}
