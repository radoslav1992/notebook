import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { extractFromPdf } = await import('../src/lib/extract/pdf.ts');
const load = (f) => { const b = readFileSync(new URL('fixtures/' + f, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

const out = await extractFromPdf(load('sample.pdf'));
console.log('  pages reported:', out.pageCount);
console.log('  passages:', out.passages.map(p => `${p.locator} (page ${p.page})`).join(', '));
assert.equal(out.pageCount, 3);

// Every passage must carry the page it came from — this is what makes
// citations say "стр. 12" instead of guessing.
for (const p of out.passages) {
  assert.ok(Number.isInteger(p.page) && p.page >= 1 && p.page <= 3, 'bad page: ' + p.page);
  assert.equal(p.locator, 'стр. ' + p.page);
}
const byPage = new Map(out.passages.map(p => [p.page, p.text]));
assert.ok(byPage.get(1).includes('55 percent'), 'page 1 text: ' + byPage.get(1));
assert.ok(byPage.get(2).includes('Modernisation Fund'), 'page 2 text: ' + byPage.get(2));
assert.ok(byPage.get(3).includes('2038'), 'page 3 text: ' + byPage.get(3));
// No cross-page bleed: the page-3 contradiction must not be filed under page 1.
assert.ok(!byPage.get(1).includes('2038'), 'page boundaries leaked');
console.log('  ok  page-accurate extraction');

await assert.rejects(() => extractFromPdf(load('blank.pdf')), /текстов слой/);
console.log('  ok  scanned/empty PDF gets the OCR hint');
console.log('\npdf reader OK');
