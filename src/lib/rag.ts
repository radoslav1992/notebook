import type { FileSearchTool, GroundingMetadata } from './gemini';
import type { Citation, Message, Source } from './types';

export const GROUNDED_SYSTEM_PROMPT = `You are a research assistant embedded in a notebook. The user has uploaded a set of sources, and you answer strictly from them.

Rules:
- Ground every factual claim in the retrieved source passages. Never use outside knowledge to state a fact.
- If the sources do not cover the question, say so plainly in one sentence and describe what the sources *do* cover that is adjacent. Do not speculate.
- Quote sparingly and only when the exact wording matters.
- Be direct. Lead with the answer, then support it. No preamble like "Based on the sources provided".
- Use short paragraphs. Use bullet lists only when the content is genuinely a list.
- Match the language of the user's question.
- When sources disagree, say so and give both positions rather than silently picking one.`;

/**
 * Builds the File Search tool.
 *
 * Pass `sourceIds` to restrict retrieval to those sources — it becomes a
 * metadata filter over the `source_id` we attach at upload time. Omit it to
 * search the whole store.
 */
export function fileSearchTool(
  storeName: string,
  opts: { sourceIds?: string[] } = {},
): FileSearchTool[] {
  const ids = opts.sourceIds;
  return [
    {
      fileSearch: {
        fileSearchStoreNames: [storeName],
        ...(ids?.length
          ? { metadataFilter: ids.map((id) => `source_id=${JSON.stringify(id)}`).join(' OR ') }
          : {}),
      },
    },
  ];
}

/** Only filter when the user has actually narrowed the set — it costs recall. */
export function scopeToSelection(selected: string[], all: string[]): { sourceIds?: string[] } {
  return selected.length > 0 && selected.length < all.length ? { sourceIds: selected } : {};
}

/**
 * Turns Gemini's grounding metadata into the numbered citations the UI renders,
 * resolving each retrieved chunk back to the source row it came from.
 *
 * Preference order for resolution: exact document resource name, then exact
 * title. Unresolvable chunks still produce a citation, just without a link.
 */
export function mapCitations(
  meta: GroundingMetadata | undefined,
  sources: Array<Pick<Source, 'id' | 'title'> & { docName?: string | null }>,
): Citation[] {
  const chunks = meta?.groundingChunks ?? [];
  if (!chunks.length) return [];

  const byDocName = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const s of sources) {
    if (s.docName) byDocName.set(s.docName, s.id);
    byTitle.set(s.title.toLowerCase(), s.id);
  }

  // A chunk index only earns a citation number if something actually cites it.
  const usedChunkIndices = new Set<number>();
  for (const support of meta?.groundingSupports ?? []) {
    for (const i of support.groundingChunkIndices ?? []) usedChunkIndices.add(i);
  }
  // Some responses omit groundingSupports entirely; fall back to every chunk.
  const indices = usedChunkIndices.size
    ? [...usedChunkIndices].sort((a, b) => a - b)
    : chunks.map((_, i) => i);

  const numberByChunk = new Map<number, number>();
  const citations: Citation[] = [];

  for (const chunkIndex of indices) {
    const ctx = chunks[chunkIndex]?.retrievedContext;
    if (!ctx) continue;
    const title = ctx.title?.trim() || 'Source';
    const sourceId =
      (ctx.documentName ? byDocName.get(ctx.documentName) : undefined) ??
      byTitle.get(title.toLowerCase()) ??
      null;

    const index = citations.length + 1;
    numberByChunk.set(chunkIndex, index);
    citations.push({
      index,
      sourceId,
      sourceTitle: title,
      quote: (ctx.text ?? '').trim().slice(0, 4000),
    });
  }

  // Attach the answer offsets so the client can place markers inline.
  for (const support of meta?.groundingSupports ?? []) {
    const seg = support.segment;
    if (!seg || seg.endIndex == null) continue;
    for (const chunkIndex of support.groundingChunkIndices ?? []) {
      const n = numberByChunk.get(chunkIndex);
      if (!n) continue;
      const citation = citations[n - 1];
      // Keep the earliest supported span for each citation.
      if (citation.endIndex == null) {
        citation.startIndex = seg.startIndex ?? 0;
        citation.endIndex = seg.endIndex;
      }
    }
  }

  return citations;
}

/**
 * Inserts `[n]` markers into the answer at the byte offsets Gemini reported.
 * Offsets are UTF-8 byte offsets, so we walk the encoded buffer rather than the
 * JS string to avoid drifting on non-ASCII text.
 */
export function annotateWithCitations(text: string, citations: Citation[]): string {
  const marked = citations.filter((c) => c.endIndex != null);
  if (!marked.length) return text;

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(text);

  // Group citations that end at the same offset so they render as [1][2].
  const byOffset = new Map<number, number[]>();
  for (const c of marked) {
    const at = Math.min(c.endIndex!, bytes.length);
    const list = byOffset.get(at) ?? [];
    list.push(c.index);
    byOffset.set(at, list);
  }

  const offsets = [...byOffset.keys()].sort((a, b) => a - b);
  let out = '';
  let cursor = 0;
  for (const offset of offsets) {
    if (offset < cursor) continue;
    out += decoder.decode(bytes.slice(cursor, offset));
    out += byOffset.get(offset)!.sort((a, b) => a - b).map((n) => `[${n}]`).join('');
    cursor = offset;
  }
  out += decoder.decode(bytes.slice(cursor));
  return out;
}

/** Recent turns, trimmed so a long thread cannot blow the context budget. */
export function toGeminiHistory(messages: Message[], limit = 12) {
  return messages.slice(-limit).map((m) => ({
    role: m.role === 'assistant' ? ('model' as const) : ('user' as const),
    // Citation markers are UI sugar; strip them before replaying history.
    parts: [{ text: m.content.replace(/\[\d+\]/g, '') }],
  }));
}
