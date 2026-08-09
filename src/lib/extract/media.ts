import { Gemini, bytesToBase64 } from '../gemini';
import type { Extraction, Passage } from '../types';
import { normalizeWhitespace } from './html';

const TRANSCRIPT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          start: { type: 'string', description: 'Начало на сегмента като M:SS или H:MM:SS' },
          text: { type: 'string' },
        },
        required: ['start', 'text'],
      },
    },
  },
  required: ['segments'],
} as const;

interface TranscriptResult {
  title?: string;
  segments: { start: string; text: string }[];
}

const TRANSCRIPT_PROMPT = `Направи подробен запис на съдържанието на този материал.
Раздели го на смислови сегменти от по 60–120 секунди. За всеки сегмент дай началния времеви код и текста.
Пиши на езика, на който се говори в материала. Не съкращавай и не резюмирай — предай казаното.
Ако материалът е на български, запази оригиналната терминология.`;

/**
 * YouTube линк: подава се на Gemini като fileData и се връща запис с времеви
 * кодове, така че цитатите да сочат към момент във видеото („34:12“).
 */
export async function extractFromYouTube(gemini: Gemini, url: string): Promise<Extraction & { title?: string }> {
  const res = await gemini.generate({
    contents: [
      {
        role: 'user',
        parts: [{ fileData: { fileUri: url } }, { text: TRANSCRIPT_PROMPT }],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: TRANSCRIPT_SCHEMA,
      temperature: 0.1,
      maxOutputTokens: 32_000,
    },
  });
  return toExtraction(parseTranscript(res));
}

/** Аудио файл: подава се вградено (base64). Практичният таван е около 18 MB. */
export async function extractFromAudio(
  gemini: Gemini,
  bytes: ArrayBuffer,
  mimeType: string,
): Promise<Extraction & { title?: string }> {
  const MAX_INLINE = 18 * 1024 * 1024;
  if (bytes.byteLength > MAX_INLINE) {
    throw new Error(
      'Аудио файлът е над 18 MB. Раздели го или качи текстов запис вместо него.',
    );
  }
  const res = await gemini.generate({
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: bytesToBase64(new Uint8Array(bytes)) } },
          { text: TRANSCRIPT_PROMPT },
        ],
      },
    ],
    config: {
      responseMimeType: 'application/json',
      responseSchema: TRANSCRIPT_SCHEMA,
      temperature: 0.1,
      maxOutputTokens: 32_000,
    },
  });
  return toExtraction(parseTranscript(res));
}

/* ── вътрешни ────────────────────────────────────────────────────────────── */

function parseTranscript(res: Parameters<typeof rawText>[0]): TranscriptResult {
  const raw = rawText(res);
  try {
    return JSON.parse(raw) as TranscriptResult;
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as TranscriptResult;
      } catch {
        /* пада надолу */
      }
    }
    // Ако моделът е дал само проза, я ползваме като един сегмент.
    if (raw.length > 40) return { segments: [{ start: '0:00', text: raw }] };
    throw new Error('Не успях да разчета съдържанието на материала.');
  }
}

function rawText(res: { candidates?: { content?: { parts?: { text?: string }[] } }[] }): string {
  return (res.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

function toExtraction(t: TranscriptResult): Extraction & { title?: string } {
  const passages: Passage[] = [];
  let buffer = '';
  let bufferStart = '';

  const flush = () => {
    const text = normalizeWhitespace(buffer);
    if (text.length < 20) return;
    passages.push({ text, page: toSeconds(bufferStart), locator: bufferStart || '0:00' });
    buffer = '';
    bufferStart = '';
  };

  for (const seg of t.segments ?? []) {
    const text = (seg.text ?? '').trim();
    if (!text) continue;
    if (!bufferStart) bufferStart = (seg.start ?? '0:00').trim();
    buffer += (buffer ? '\n' : '') + text;
    if (buffer.length >= 1400) flush();
  }
  flush();

  if (passages.length === 0) {
    throw new Error('Материалът не съдържа разпознаваема реч.');
  }
  return { passages, pageCount: 0, title: t.title?.trim() || undefined };
}

/** „1:12:40“ → 4360 */
function toSeconds(stamp: string): number {
  const parts = stamp.split(':').map((n) => Number(n) || 0);
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  return parts[0] ?? 0;
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
}
