import { Gemini, groundingChunksOf, textOf } from './gemini';
import {
  getChunksByIds,
  getChunksForSources,
  getSourcesByIds,
  searchChunksByKeyword,
  searchDatasetsByKeyword,
} from './db';
import { ftsQuery, rrf } from './search';
import { requireGoogleFeature, type Ai } from './ai';
import { isDimensionMismatch, vectorError } from './vector';
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
  ai: Ai;
  backend: 'vectorize' | 'gemini';
  storeName?: string | null;
  language: string;
}

const TOP_K = 10;
const OVERFETCH = 30;
/**
 * До колко източника се стеснява още в индекса. Над това `$in` става дълъг, а
 * таванът му при Vectorize не е обещан — затова минаваме на широко търсене и
 * отсяване в кода, което и без това е истинската преграда.
 */
const FILTER_MAX_SOURCES = 20;

/* ── Извличане ───────────────────────────────────────────────────────────── */

export async function retrieve(
  ctx: RagContext,
  query: string,
  sources: Source[],
  datasets: string[] = [],
): Promise<Retrieved[]> {
  if (sources.length === 0 && datasets.length === 0) return [];

  /**
   * До четири класирания: смисъл и дума, поотделно за своите източници и за
   * включените набори.
   *
   * Наборите се търсят отделно, а не с разширен списък източници, защото те са
   * стотици документа — списък с толкова идентификатора не се побира в филтъра, а
   * и не може да се зареди наведнъж. Понеже наборът Е тетрадка, стеснява се по
   * `notebookId`, което вече е индексирано.
   *
   * Сливането е същото: RRF не се интересува колко списъка са, само от реда в тях.
   */
  const match = ftsQuery(query);
  const sourceIds = sources.map((s) => s.id);
  const [vectorIds, keywordIds, datasetVectorIds, datasetKeywordIds] = await Promise.all([
    sourceIds.length ? searchByMeaning(ctx, query, sourceIds) : Promise.resolve<string[]>([]),
    match && sourceIds.length
      ? searchChunksByKeyword(ctx.db, sourceIds, match, OVERFETCH)
      : Promise.resolve<string[]>([]),
    datasets.length ? searchDatasets(ctx, query, datasets) : Promise.resolve<string[]>([]),
    match && datasets.length
      ? searchDatasetsByKeyword(ctx.db, datasets, match, OVERFETCH)
      : Promise.resolve<string[]>([]),
  ]);

  // Само непразните класирания влизат в сливането: списък с нула пасажа не
  // значи „всичко е еднакво лошо“, а „това търсене няма мнение“.
  const fused = rrf(
    [vectorIds, keywordIds, datasetVectorIds, datasetKeywordIds].filter((list) => list.length > 0),
  );
  if (fused.length === 0) return [];

  const rows = await getChunksByIds(
    ctx.db,
    fused.map((f) => f.id),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  /**
   * Разрешените източници — и преградата, и таблицата за имената им.
   *
   * Нарочно е ЕДНА структура. Имаше и отделен `Set` с позволените,
   * но той се строеше от същия списък, тоест проверката с него не можеше да
   * се провали, докато тази отдолу минава. Изглеждаше като преграда, без да е —
   * а два източника на една истина се разминават точно когато някой добави
   * трети вид достъп (обща библиотека например) и допише само единия.
   */
  const bySource = new Map(sources.map((s) => [s.id, s]));

  /**
   * Източниците от набор се зареждат допълнително и само тези, чиито пасажи реално
   * са изплували — наборът е стотици документа и не се побира в паметта наготово.
   *
   * Номерата им продължават след своите, за да не сочи един и същ чип към две
   * различни неща.
   */
  const allowedDatasets = new Set(datasets);
  const fromDatasets = fused
    .map((f) => byId.get(f.id))
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .filter((row) => !bySource.has(row.source_id) && allowedDatasets.has(row.notebook_id));

  if (fromDatasets.length > 0) {
    const extra = await getSourcesByIds(ctx.db, [...new Set(fromDatasets.map((r) => r.source_id))]);
    let ordinal = sources.reduce((max, s) => Math.max(max, s.ordinal), 0);
    for (const source of extra) bySource.set(source.id, { ...source, ordinal: ++ordinal });
  }

  const kept: Retrieved[] = [];
  for (const f of fused) {
    const row = byId.get(f.id);
    if (!row) continue;
    /**
     * Последната преграда преди контекста на модела.
     *
     * Проверката е по ИЗТОЧНИК, не по тетрадка, и това не е разхлабване: един
     * източник е в точно една тетрадка, тоест разрешеният източник вече значи
     * разрешена тетрадка. Обратното не важи, откакто има общи библиотеки —
     * пасаж от библиотеката принадлежи на тетрадката на организацията, не на
     * тази, която пита, така че проверка по тетрадка би отхвърлила точно
     * законните споделени пасажи.
     *
     * Кои източници са разрешени се решава на едно място: `listAllowedSources`.
     */
    const source = bySource.get(row.source_id);
    if (!source) continue;
    kept.push({
      index: kept.length + 1,
      sourceId: source.id,
      sourceOrdinal: source.ordinal,
      sourceName: source.name,
      locator: row.locator,
      text: row.text,
      score: f.score,
    });
    if (kept.length >= TOP_K) break;
  }
  return kept;
}

/** Търсене по смисъл във Vectorize — връща идентификатори, подредени по близост. */
async function searchByMeaning(
  ctx: RagContext,
  query: string,
  sourceIds: string[],
): Promise<string[]> {
  const [vector] = await ctx.ai.embed.embed([query], 'RETRIEVAL_QUERY');
  if (!vector) return [];

  /**
   * Стеснява се по източник, защото само това важи и за общите библиотеки.
   * Списъкът може да е дълъг, а `$in` има таван, затова при много източници
   * търсим широко и отсяваме в кода — преградата е там така или иначе, а по-скъпо
   * е само по трафик.
   */
  const filter =
    sourceIds.length <= FILTER_MAX_SOURCES ? { sourceId: { $in: sourceIds } } : undefined;

  try {
    const res = await ctx.vectorize.query(vector, {
      topK: filter ? OVERFETCH : OVERFETCH * 2,
      filter: filter as VectorizeVectorMetadataFilter | undefined,
      returnValues: false,
      returnMetadata: 'none',
    });
    return res.matches.map((m) => m.id);
  } catch (err) {
    // Сгрешена ширина не е проблем на филтъра: вторият опит ще падне по същия
    // начин, а после отговорът излиза „в източниците няма нищо“, което е лъжа.
    if (isDimensionMismatch(err)) throw vectorError(err, ctx.ai.embed.dimensions);
    // Ако филтърът не мине (липсващ индекс по метаданни), търсим широко и
    // отсяваме след това.
    const res = await ctx.vectorize.query(vector, { topK: OVERFETCH * 2, returnMetadata: 'none' });
    return res.matches.map((m) => m.id);
  }
}

/**
 * Търсене по смисъл в набори.
 *
 * Стеснява се по `notebookId`, защото наборът Е тетрадка — това поле вече е
 * индексирано в метаданните и не иска нито ново поле, нито пресъздаване на
 * индекса (метаданните не важат назад).
 *
 * Ако филтърът откаже, тук НЕ се пада на широко търсене, за разлика от своите
 * източници: там широкото търсене е по-скъпо, но безопасно, защото преградата в
 * кода го отсява. При наборите широкото търсене би върнало пасажи от набори, до
 * които човекът няма право — те пак ще отпаднат, но по-добре да не се търсят.
 */
async function searchDatasets(
  ctx: RagContext,
  query: string,
  datasetIds: string[],
): Promise<string[]> {
  const [vector] = await ctx.ai.embed.embed([query], 'RETRIEVAL_QUERY');
  if (!vector) return [];

  try {
    const res = await ctx.vectorize.query(vector, {
      topK: OVERFETCH,
      filter: { notebookId: { $in: datasetIds } } as VectorizeVectorMetadataFilter,
      returnValues: false,
      returnMetadata: 'none',
    });
    return res.matches.map((m) => m.id);
  } catch (err) {
    if (isDimensionMismatch(err)) throw vectorError(err, ctx.ai.embed.dimensions);
    console.error('[zapiski:datasets] търсенето в набор отказа', err);
    return [];
  }
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
    /** Включените набори — минават през `allowedDatasetIds`, не идват от клиента. */
    datasets?: string[];
    history: { role: 'user' | 'ai'; text: string }[];
    model?: string;
  },
): AsyncGenerator<
  | { type: 'passages'; count: number }
  | { type: 'delta'; text: string }
  | { type: 'done'; text: string; citations: Citation[] }
> {
  // Празно значи „нито свои източници, нито включен набор“. Проверката е писана
  // преди наборите и гледаше само своите — тетрадка САМО с Кодекса на труда
  // получаваше „няма избрани източници“ при отметнат набор вляво.
  if (input.sources.length === 0 && (input.datasets ?? []).length === 0) {
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

  const passages = await retrieve(ctx, input.question, input.sources, input.datasets ?? []);
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
  for await (const part of ctx.ai.chat.stream({
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
  warnIfUncited(ctx, passages.length, final);

  const alreadyShown = stripCitationMarkers(raw.slice(0, emitted));
  const tail = final.text.slice(alreadyShown.length);
  if (tail) yield { type: 'delta', text: tail };
  yield { type: 'done', text: final.text, citations: final.citations };
}

/**
 * Отговор без нито един цитат, при положение че сме дали пасажи.
 *
 * Това е тихият провал, който трябва да се вижда: цялото обещание на
 * приложението е „всеки отговор идва с препратка“, а то се държи само от това
 * моделът да пише маркери `[3]`. Спре ли да ги пише — сменен на по-евтин модел,
 * променена подсказка, нова версия отсреща — `extractCitations` не намира нищо,
 * отговорът пак се показва, а чиповете просто изчезват. Нищо не гърми.
 *
 * Затова случаят влиза в лога с модела и с началото на отговора: в
 * `wrangler tail` се вижда веднага, вместо да се забележи седмици по-късно.
 */
function warnIfUncited(
  ctx: RagContext,
  passageCount: number,
  final: { text: string; citations: Citation[] },
): void {
  if (passageCount === 0 || final.citations.length > 0) return;
  // Отказът „в източниците няма отговор“ е редно да е без цитати.
  if (/няма отговор|не намирам|не открих/i.test(final.text)) return;

  console.warn('[zapiski:citations] отговор без нито една препратка', {
    model: ctx.ai.chat.model,
    passages: passageCount,
    chars: final.text.length,
    answer: final.text.slice(0, 200),
  });
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
  const google = requireGoogleFeature(ctx.ai, 'Търсенето през File Search');
  const tool = Gemini.fileSearchTool([ctx.storeName!]);
  const res = await google.generate({
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
