/**
 * Прави тестовите файлове на място, вместо да ги държим като двоични файлове
 * в хранилището: така се вижда точно какво се тества.
 *
 *   node tests/fixtures/build.mjs
 */
import { deflateRawSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
mkdirSync(here, { recursive: true });

/* ── PDF с истински текстов слой ─────────────────────────────────────────── */

function buildPdf(pages) {
  const objects = new Map();
  const fontId = 3 + 2 * pages.length;
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(
    2,
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 2 * i} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  );

  pages.forEach((lines, i) => {
    const pageId = 3 + 2 * i;
    const contentId = pageId + 1;
    objects.set(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    const body =
      'BT /F1 12 Tf 72 720 Td 14 TL\n' +
      lines
        .map((l) => `(${l.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')}) Tj T*`)
        .join('\n') +
      '\nET';
    objects.set(contentId, `<< /Length ${body.length} >>\nstream\n${body}\nendstream`);
  });
  objects.set(fontId, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const chunks = [Buffer.from('%PDF-1.4\n', 'latin1')];
  let at = chunks[0].length;
  const offsets = new Map();
  for (const id of [...objects.keys()].sort((a, b) => a - b)) {
    offsets.set(id, at);
    const buf = Buffer.from(`${id} 0 obj\n${objects.get(id)}\nendobj\n`, 'latin1');
    chunks.push(buf);
    at += buf.length;
  }
  const xrefAt = at;
  const highest = Math.max(...objects.keys()) + 1;
  let xref = `xref\n0 ${highest}\n0000000000 65535 f \n`;
  for (let id = 1; id < highest; id++) {
    xref += offsets.has(id)
      ? `${String(offsets.get(id)).padStart(10, '0')} 00000 n \n`
      : '0000000000 65535 f \n';
  }
  chunks.push(Buffer.from(xref, 'latin1'));
  chunks.push(
    Buffer.from(`trailer\n<< /Size ${highest} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`, 'latin1'),
  );
  return Buffer.concat(chunks);
}

/* ── ZIP (за .docx) ──────────────────────────────────────────────────────── */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function buildZip(entries, { store = false, comment = '' } = {}) {
  const locals = [];
  const central = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const raw = Buffer.from(text, 'utf8');
    const data = store ? raw : deflateRawSync(raw);
    const method = store ? 0 : 8;
    const nameBuf = Buffer.from(name, 'utf8');

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(0x0800, 6); // UTF-8 имена
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt32LE(crc32(raw), 14);
    lfh.writeUInt32LE(data.length, 18);
    lfh.writeUInt32LE(raw.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lfh, nameBuf, data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(crc32(raw), 16);
    cd.writeUInt32LE(data.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);

    offset += lfh.length + nameBuf.length + data.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(central);
  const commentBuf = Buffer.from(comment, 'utf8');
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(commentBuf.length, 20);
  return Buffer.concat([localPart, centralPart, eocd, commentBuf]);
}

/* ── Съдържанието ────────────────────────────────────────────────────────── */

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Климатични цели</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">До 2030 ЕС се ангажира с намаление на нетните емисии с поне </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>55%</w:t></w:r><w:r><w:t xml:space="preserve"> спрямо 1990 г.</w:t></w:r></w:p>
<w:p><w:r><w:t>Ред с</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>табулация и &amp;amp; знак &#1073;.</w:t></w:r></w:p>
<w:p/>
<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Финансиране</w:t></w:r></w:p>
<w:p><w:r><w:t>Средствата идват през Фонда за модернизация.</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Втори ред след прекъсване.</w:t></w:r></w:p>
</w:body></w:document>`;

const CONTENT_TYPES =
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>';
const RELS =
  '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';

const docxEntries = [
  ['[Content_Types].xml', CONTENT_TYPES],
  ['_rels/.rels', RELS],
  ['word/document.xml', DOCUMENT_XML],
  ['word/styles.xml', '<styles/>'],
];

const files = {
  // Три страници с различно съдържание — проверява, че границите не се смесват.
  'sample.pdf': buildPdf([
    [
      'EUROPEAN GREEN DEAL',
      'Page one discusses the 2050 climate neutrality target',
      'and the intermediate goal of at least 55 percent net emission cuts by 2030.',
    ],
    [
      'FINANCING',
      'Page two covers the Modernisation Fund and the Just Transition Mechanism.',
      'Bulgaria draws most of its funding from emissions trading revenue.',
    ],
    [
      'TIMELINE',
      'Page three states lignite capacity closes by 2038,',
      'which contradicts the 2035 date used in the lecture notes.',
    ],
  ]),
  // Само няколко знака текст — все едно е сканиран документ.
  'blank.pdf': buildPdf([['1']]),
  'sample.docx': buildZip(docxEntries),
  'stored.docx': buildZip(docxEntries, { store: true }),
  'commented.docx': buildZip([['word/document.xml', DOCUMENT_XML]], { comment: 'x'.repeat(300) }),
  'notzip.docx': Buffer.from('this is plain text, not a zip archive at all', 'utf8'),
};

for (const [name, buf] of Object.entries(files)) {
  writeFileSync(join(here, name), buf);
  console.log(`  ${name} (${buf.length} B)`);
}
