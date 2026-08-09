import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { extractFromDocx } = await import('../src/lib/extract/docx.ts');

const load = (f) => { const b = readFileSync(new URL('fixtures/' + f, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

for (const file of ['sample.docx', 'stored.docx', 'commented.docx']) {
  const out = await extractFromDocx(load(file));
  const all = out.passages.map(p => p.text).join('\n');
  assert.ok(all.includes('До 2030 ЕС се ангажира'), file + ': body text missing');
  assert.ok(all.includes('55%'), file + ': bold run lost');
  assert.ok(all.includes('спрямо 1990 г.'), file + ': run split lost');
  assert.ok(all.includes('Средствата идват през Фонда'), file + ': later paragraph lost');
  assert.ok(all.includes('Втори ред след прекъсване'), file + ': <w:br/> lost');
  assert.ok(all.includes('знак б'), file + ': numeric entity not decoded');
  assert.ok(!all.includes('<w:'), file + ': XML leaked');
  const locators = out.passages.map(p => p.locator).join(' | ');
  assert.ok(/Климатични цели/.test(locators) || /раздел/.test(locators), file + ': no locators — ' + locators);
  console.log('  ok  ' + file + ' → ' + out.passages.length + ' passage(s), locators: ' + locators);
}

await assert.rejects(() => extractFromDocx(load('notzip.docx')), /валиден \.docx/);
console.log('  ok  non-zip rejected with a readable message');
console.log('\ndocx reader OK');
