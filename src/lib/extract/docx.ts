import type { Extraction } from '../types';
import { decodeEntities, normalizeWhitespace, splitIntoPassages } from './html';

/**
 * .docx е ZIP с XML вътре. Вместо тежка зависимост четем архива на ръка и
 * ползваме `DecompressionStream('deflate-raw')`, което Workers предоставя.
 */
export async function extractFromDocx(bytes: ArrayBuffer): Promise<Extraction> {
  const xml = await readZipEntryAsText(bytes, 'word/document.xml');
  if (!xml) {
    throw new Error('Файлът не изглежда като валиден .docx документ.');
  }
  const text = docxXmlToText(xml);
  if (text.length < 20) {
    throw new Error('В документа не беше намерен текст.');
  }
  return { passages: splitIntoPassages(text), pageCount: 0 };
}

function docxXmlToText(xml: string): string {
  let out = xml;
  // Заглавията стават markdown, за да оцелеят като места за цитиране.
  out = out.replace(
    /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g,
    (_m, inner: string) => {
      const isHeading = /w:val="Heading[1-3]"|w:val="Заглавие/.test(inner);
      const body = inner
        .replace(/<w:tab\b[^>]*\/?>/g, '\t')
        .replace(/<w:br\b[^>]*\/?>/g, '\n')
        .replace(/<[^>]+>/g, '');
      const clean = decodeEntities(body).trim();
      if (!clean) return '\n';
      return isHeading ? `\n\n## ${clean}\n\n` : `\n\n${clean}`;
    },
  );
  out = out.replace(/<[^>]+>/g, ' ');
  return normalizeWhitespace(decodeEntities(out));
}

/* ── минимален ZIP четец ─────────────────────────────────────────────────── */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

async function readZipEntryAsText(buffer: ArrayBuffer, wantedName: string): Promise<string | null> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const eocd = findEocd(view, bytes.length);
  if (eocd < 0) return null;

  const entryCount = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true); // отместване на централната директория

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CD_SIG) return null;

    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(cursor + 46, cursor + 46 + nameLen));

    if (name === wantedName) {
      if (view.getUint32(localOffset, true) !== LFH_SIG) return null;
      const lfhNameLen = view.getUint16(localOffset + 26, true);
      const lfhExtraLen = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + lfhNameLen + lfhExtraLen;
      const data = bytes.subarray(dataStart, dataStart + compressedSize);

      if (method === 0) return new TextDecoder().decode(data);
      if (method === 8) return new TextDecoder().decode(await inflateRaw(data));
      throw new Error(`Неподдържана компресия в .docx (метод ${method}).`);
    }

    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function findEocd(view: DataView, length: number): number {
  // Крайният запис е в последните 64 KiB (заради опционалния коментар).
  const from = Math.max(0, length - 66_000);
  for (let i = length - 22; i >= from; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
