import { mapWithConcurrency } from './gemini';
import { requireGoogleFeature, type Ai } from './ai';
import { insertChunks, updateSourceStatus } from './db';
import { newId } from './ids';
import { extractFromDocx } from './extract/docx';
import { extractFromPdf } from './extract/pdf';
import { extractFromPlainText, extractFromUrl } from './extract/html';
import { extractFromAudio, extractFromYouTube, isYouTubeUrl } from './extract/media';
import type { Extraction, Source, SourceKind } from './types';

export { MAX_UPLOAD_BYTES } from './constants';

export interface IngestContext {
  db: D1Database;
  files: R2Bucket;
  vectorize: VectorizeIndex;
  ai: Ai;
  /** 'vectorize' = собствен RAG; 'gemini' = File Search на Google. */
  backend: 'vectorize' | 'gemini';
  /** Нужно само при backend='gemini'. */
  storeName?: string | null;
}

/**
 * Пълният път на един източник: извличане на текст → пасажи → вграждания →
 * Vectorize (или качване към File Search) → готов за питане.
 *
 * Пуска се във фонов режим през `ctx.waitUntil`, затова сам записва
 * състоянието си в базата и никога не хвърля навън.
 */
export async function ingestSource(ctx: IngestContext, source: Source): Promise<void> {
  const { db } = ctx;
  try {
    await updateSourceStatus(db, source.id, { status: 'indexing' });

    const extraction = await extract(ctx, source);
    const charCount = extraction.passages.reduce((n, p) => n + p.text.length, 0);

    if (ctx.backend === 'gemini' && ctx.storeName) {
      await indexWithFileSearch(ctx, source, extraction);
    } else {
      await indexWithVectorize(ctx, source, extraction);
    }

    await updateSourceStatus(db, source.id, {
      status: 'ready',
      pageCount: extraction.pageCount,
      charCount,
      sub: describeSource(source.kind, extraction, charCount),
    });
  } catch (err) {
    // Фоновата обработка няма кой да я види, ако не се запише: в базата за
    // потребителя, в лога за `wrangler tail`.
    console.error('[zapiski:ingest]', source.kind, source.id, err);
    const message = err instanceof Error ? err.message : String(err);
    await updateSourceStatus(db, source.id, {
      status: 'error',
      error: message.slice(0, 500),
      sub: 'грешка при обработка',
    });
  }
}

/* ── извличане ───────────────────────────────────────────────────────────── */

async function extract(ctx: IngestContext, source: Source): Promise<Extraction> {
  switch (source.kind) {
    case 'WEB': {
      if (!source.originUrl) throw new Error('Липсва адрес на източника.');
      return extractFromUrl(source.originUrl);
    }
    case 'YT': {
      if (!source.originUrl) throw new Error('Липсва адрес на видеото.');
      return extractFromYouTube(requireGoogleFeature(ctx.ai, 'YouTube по линк'), source.originUrl);
    }
    case 'PDF': {
      return extractFromPdf(await loadBytes(ctx, source));
    }
    case 'DOC': {
      return extractFromDocx(await loadBytes(ctx, source));
    }
    case 'AUD': {
      const bytes = await loadBytes(ctx, source);
      return extractFromAudio(
        requireGoogleFeature(ctx.ai, 'Разчитането на аудио файл'),
        bytes,
        mimeForName(source.name),
      );
    }
    case 'TXT': {
      const bytes = await loadBytes(ctx, source);
      return extractFromPlainText(new TextDecoder().decode(bytes));
    }
    default:
      throw new Error(`Неподдържан вид източник: ${source.kind}`);
  }
}

async function loadBytes(ctx: IngestContext, source: Source): Promise<ArrayBuffer> {
  if (!source.r2Key) throw new Error('Файлът не беше намерен в хранилището.');
  const object = await ctx.files.get(source.r2Key);
  if (!object) throw new Error('Файлът не беше намерен в хранилището.');
  return object.arrayBuffer();
}

/* ── индексиране: собствен RAG над Vectorize ─────────────────────────────── */

async function indexWithVectorize(
  ctx: IngestContext,
  source: Source,
  extraction: Extraction,
): Promise<void> {
  const passages = extraction.passages;
  const chunkRows = passages.map((p, i) => ({
    id: newId('ch'),
    source_id: source.id,
    notebook_id: source.notebookId,
    ordinal: i,
    page: p.page ?? null,
    locator: p.locator,
    text: p.text,
  }));

  await insertChunks(ctx.db, chunkRows);

  // Вграждаме на групи, за да не държим целия документ в паметта наведнъж.
  const BATCH = 32;
  const batches: number[] = [];
  for (let i = 0; i < chunkRows.length; i += BATCH) batches.push(i);

  await mapWithConcurrency(batches, 2, async (start) => {
    const slice = chunkRows.slice(start, start + BATCH);
    const vectors = await ctx.ai.embed.embed(
      slice.map((c) => `${source.name}\n\n${c.text}`),
      'RETRIEVAL_DOCUMENT',
    );
    await ctx.vectorize.upsert(
      slice.map((c, i) => ({
        id: c.id,
        values: vectors[i]!,
        metadata: {
          notebookId: c.notebook_id,
          sourceId: c.source_id,
          ordinal: c.ordinal,
        },
      })),
    );
  });
}

/* ── индексиране: File Search на Google ──────────────────────────────────── */

async function indexWithFileSearch(
  ctx: IngestContext,
  source: Source,
  extraction: Extraction,
): Promise<void> {
  // Подаваме вече извлечения текст, а не оригиналния файл: така пасажите носят
  // мястото си („стр. 12“) вътре в текста и цитатите остават проследими.
  const doc = extraction.passages
    .map((p) => `[${p.locator}]\n${p.text}`)
    .join('\n\n');

  const google = requireGoogleFeature(ctx.ai, 'Индексирането през File Search');
  const docName = await google.uploadToFileSearchStore({
    storeName: ctx.storeName!,
    bytes: new TextEncoder().encode(doc),
    mimeType: 'text/plain',
    // Номерът отпред е единственото, което гарантирано връща обратно към
    // източника: groundingMetadata носи само `title`, не и метаданните ни.
    displayName: `${source.ordinal} · ${source.name}`,
    customMetadata: [
      { key: 'sourceId', stringValue: source.id },
      { key: 'ordinal', numericValue: source.ordinal },
    ],
  });

  // Пазим и пасажите локално — нужни са за подкаста и мисловната карта.
  await insertChunks(
    ctx.db,
    extraction.passages.map((p, i) => ({
      id: newId('ch'),
      source_id: source.id,
      notebook_id: source.notebookId,
      ordinal: i,
      page: p.page ?? null,
      locator: p.locator,
      text: p.text,
    })),
  );

  await updateSourceStatus(ctx.db, source.id, { status: 'indexing', docName });
}

/* ── помощни ─────────────────────────────────────────────────────────────── */

/** Подредът под името на източника: „48 стр. · добавен вчера“. */
function describeSource(kind: SourceKind, extraction: Extraction, charCount: number): string {
  if (kind === 'WEB') return 'уеб страница';
  if (kind === 'YT' || kind === 'AUD') {
    const last = extraction.passages[extraction.passages.length - 1];
    const seconds = last?.page ?? 0;
    return seconds > 0 ? `запис · до ${formatStamp(seconds)}` : 'аудио запис';
  }
  if (extraction.pageCount > 0) return `${extraction.pageCount} стр.`;
  const kb = Math.max(1, Math.round(charCount / 1000));
  return `${kb} хил. знака`;
}

function formatStamp(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

const EXT_KIND: Record<string, SourceKind> = {
  pdf: 'PDF',
  docx: 'DOC',
  doc: 'DOC',
  txt: 'TXT',
  md: 'TXT',
  markdown: 'TXT',
  csv: 'TXT',
  rtf: 'TXT',
  mp3: 'AUD',
  m4a: 'AUD',
  wav: 'AUD',
  ogg: 'AUD',
  oga: 'AUD',
  flac: 'AUD',
  aac: 'AUD',
};

export function kindForFile(name: string, mimeType?: string): SourceKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const byExt = EXT_KIND[ext];
  if (byExt) return byExt;
  if (mimeType?.startsWith('audio/')) return 'AUD';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType?.includes('wordprocessingml')) return 'DOC';
  if (mimeType?.startsWith('text/')) return 'TXT';
  throw new Error(
    `Форматът „${ext || mimeType || 'непознат'}“ не се поддържа. Приемам PDF, .docx, .txt, .md и аудио.`,
  );
}

export function kindForUrl(url: string): SourceKind {
  return isYouTubeUrl(url) ? 'YT' : 'WEB';
}

const MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

export function mimeForName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'application/octet-stream';
}
