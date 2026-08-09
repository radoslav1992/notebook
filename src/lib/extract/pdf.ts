import type { Extraction, Passage } from '../types';
import { normalizeWhitespace } from './html';

/**
 * Извлича текст от PDF, страница по страница.
 * `unpdf` е сглобка на pdf.js без Node-зависимости и работи във Workers.
 *
 * Пазенето на границите на страниците е важно: точно от тях излизат
 * препратките „стр. 12“, които дизайнът показва под всеки отговор.
 */
export async function extractFromPdf(bytes: ArrayBuffer): Promise<Extraction> {
  const { extractText, getDocumentProxy } = await import('unpdf');

  const doc = await getDocumentProxy(new Uint8Array(bytes));
  const { totalPages, text } = await extractText(doc, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text : [String(text)];

  const passages: Passage[] = [];
  for (let i = 0; i < pages.length; i++) {
    const clean = normalizeWhitespace(pages[i] ?? '');
    if (clean.length < 25) continue; // прескачаме празни/само-с-номер страници
    const page = i + 1;
    for (const part of splitPage(clean)) {
      passages.push({ text: part, page, locator: `стр. ${page}` });
    }
  }

  if (passages.length === 0) {
    throw new Error(
      'В PDF-а няма текстов слой. Ако е сканиран, направи го търсим (OCR) и опитай пак.',
    );
  }

  return { passages, pageCount: totalPages || pages.length };
}

/** Много дългите страници се цепят, за да останат пасажите смилаеми за вграждане. */
function splitPage(text: string, targetChars = 1600): string[] {
  if (text.length <= targetChars) return [text];
  const sentences = text.split(/(?<=[.!?…])\s+/);
  const out: string[] = [];
  let buf = '';
  for (const s of sentences) {
    if (buf && buf.length + s.length > targetChars) {
      out.push(buf.trim());
      buf = '';
    }
    buf += (buf ? ' ' : '') + s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}
