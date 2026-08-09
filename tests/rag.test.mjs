import assert from 'node:assert/strict';
const { buildAi } = await import('../src/lib/ai/index.ts');
const { retrieve, answerStream, buildContextBlock } = await import('../src/lib/rag.ts');

const HOST = 'http://127.0.0.1:8788';

/* ── Stubs shaped like the real bindings ──────────────────────────────────── */

const CHUNKS = [
  { id: 'c1', source_id: 's1', notebook_id: 'nb1', ordinal: 0, page: 12, locator: 'стр. 12', text: 'Емисиите падат с 55% до 2030.' },
  { id: 'c2', source_id: 's1', notebook_id: 'nb1', ordinal: 1, page: 27, locator: 'стр. 27', text: 'Справедлив преход като социална мярка.' },
  { id: 'c3', source_id: 's2', notebook_id: 'nb1', ordinal: 0, page: 5,  locator: 'стр. 5',  text: 'Лекцията говори за 2035 г.' },
  { id: 'c4', source_id: 's3', notebook_id: 'nb1', ordinal: 0, page: 1,  locator: 'стр. 1',  text: 'Пасаж от изключен източник.' },
  { id: 'cX', source_id: 's9', notebook_id: 'nbOTHER', ordinal: 0, page: 1, locator: 'стр. 1', text: 'Пасаж от чужда тетрадка.' },
];

const db = {
  prepare(sql) {
    const state = { sql, binds: [] };
    const api = {
      bind: (...b) => { state.binds = b; return api; },
      all: async () => {
        if (/FROM chunks WHERE id IN/.test(state.sql)) {
          const want = new Set(state.binds);
          return { results: CHUNKS.filter((c) => want.has(c.id)) };
        }
        throw new Error('unexpected sql: ' + state.sql);
      },
      first: async () => null,
      run: async () => ({}),
    };
    return api;
  },
};

let lastQuery = null;
const vectorize = {
  async query(vector, opts) {
    lastQuery = { dims: vector.length, opts };
    // Return everything, including a foreign-notebook and an unselected source,
    // so the post-filters have something to actually reject.
    return { matches: [
      { id: 'cX', score: 0.99 },
      { id: 'c3', score: 0.93 },
      { id: 'c4', score: 0.90 },
      { id: 'c1', score: 0.88 },
      { id: 'c2', score: 0.70 },
    ] };
  },
};

const src = (id, ordinal, name) => ({
  id, ordinal, name, notebookId: 'nb1', kind: 'PDF', sub: '', originUrl: null, r2Key: null,
  byteSize: 0, pageCount: 0, charCount: 0, selected: true, status: 'ready', error: null,
  docName: null, createdAt: 0,
});
const sources = [src('s1', 1, 'Зелена сделка.pdf'), src('s2', 4, 'Лекция 4.docx')];

const ctx = {
  db, vectorize,
  ai: buildAi({
    chatModel: 'gemini-2.5-flash',
    embedModel: 'gemini-embedding-001',
    ttsModel: 'gemini-3.1-flash-tts-preview',
    googleKey: 'test-key',
    googleHost: HOST,
  }),
  backend: 'vectorize',
  storeName: null,
  language: 'bg',
};

let pass = 0;
const t = (name) => { pass++; console.log('  ok  ' + name); };

/* ── retrieve ─────────────────────────────────────────────────────────────── */

const got = await retrieve(ctx, 'nb1', 'Какви са целите за 2030?', sources);

assert.equal(lastQuery.dims, 1536, 'query vector must match the Vectorize index width');
assert.deepEqual(lastQuery.opts.filter.notebookId, { $eq: 'nb1' });
assert.deepEqual(lastQuery.opts.filter.sourceId, { $in: ['s1', 's2'] });
t('embeds the query at 1536 dims and filters by notebook + selected sources');

assert.deepEqual(got.map((p) => p.text), [
  'Лекцията говори за 2035 г.',
  'Емисиите падат с 55% до 2030.',
  'Справедлив преход като социална мярка.',
]);
t('drops foreign-notebook and unselected-source matches, keeps score order');

assert.deepEqual(got.map((p) => p.index), [1, 2, 3]);
assert.deepEqual(got.map((p) => p.sourceOrdinal), [4, 1, 1]);
t('renumbers passages 1..n and carries each source ordinal');

const block = buildContextBlock(got);
assert.ok(block.startsWith('[1] Източник 4 · Лекция 4.docx · стр. 5\n'), block.slice(0, 80));
assert.equal((block.match(/^\[\d\] Източник/gm) ?? []).length, 3);
t('context block numbers passages the way the prompt asks the model to cite');

/* ── answerStream over the real SSE path ─────────────────────────────────── */

const events = [];
for await (const e of answerStream(ctx, {
  notebookId: 'nb1', question: 'Обобщи целите.', sources, history: [],
})) events.push(e);

const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text);
const done = events.at(-1);
assert.equal(events[0].type, 'passages');
assert.equal(events[0].count, 3);
assert.equal(done.type, 'done');
t('emits passages → deltas → done');

const streamed = deltas.join('');
assert.equal(streamed, done.text, 'streamed text must equal the saved text');
assert.ok(!/\[\d+\]/.test(streamed), 'raw [n] markers leaked to the UI: ' + streamed);
assert.ok(streamed.includes('55%') && streamed.includes('Фонда за модернизация'));
t('citation markers never appear in streamed output, even split across chunks');

assert.deepEqual(done.citations.map((c) => c.label), [
  '4 · Лекция 4, стр. 5',
  '1 · Зелена сделка, стр. 12',
]);
t('citations map back to source ordinal + page: ' + done.citations.map((c) => c.label).join(' | '));

/* ── no sources selected ─────────────────────────────────────────────────── */

const none = [];
for await (const e of answerStream(ctx, { notebookId: 'nb1', question: 'х', sources: [], history: [] })) none.push(e);
assert.ok(none.at(-1).text.includes('Няма избрани източници'));
assert.equal(none.at(-1).citations.length, 0);
t('says so plainly when nothing is selected, without calling the model');

console.log('\n' + pass + ' checks passed');

/* ── File Search backend: citations must survive imperfect titles ─────────── */

const fsCtx = { ...ctx, backend: 'gemini', storeName: 'fileSearchStores/store-1' };
const fsEvents = [];
for await (const e of answerStream(fsCtx, {
  notebookId: 'nb1', question: 'Обобщи.', sources, history: [],
})) fsEvents.push(e);

const fsDone = fsEvents.at(-1);
assert.equal(fsDone.type, 'done');
assert.ok(fsDone.citations.length >= 1, 'no citations from groundingMetadata');
// The mock returns titles that do NOT exactly equal our source names; the
// "N · " prefix we upload is what maps them back to ordinal + locator.
assert.deepEqual(fsDone.citations.map((c) => c.label), [
  '1 · Зелена сделка, стр. 1',
  '4 · Лекция 4, раздел „Финансиране“',
]);
assert.deepEqual(fsDone.citations.map((c) => c.sourceId), ['s1', 's2']);
t('File Search citations map back to ordinal + locator: ' + fsDone.citations.map((c) => c.label).join(' | '));
