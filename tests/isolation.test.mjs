/**
 * Изолация между тетрадки.
 *
 * Отделен файл, защото това е единственият тест, чийто провал значи изтекли чужди
 * данни, а не сбъркана функция. Всичко останало в приложението може да се оправи
 * после; това — не.
 *
 * Ключовото допускане: и двете хранилища се държат ВРАЖДЕБНО. Vectorize връща
 * всичко и си прави оглушки за филтъра по метаданни, търсенето по думи — също.
 * Тоест тестът не проверява дали филтрите работят, а дали приложението остава
 * затворено, КОГАТО те не работят. Точно това е разликата между преграда и
 * оптимизация.
 */

import assert from 'node:assert/strict';

const { buildAi } = await import('../src/lib/ai/index.ts');
const { retrieve, readAll } = await import('../src/lib/rag.ts');
const { listAllowedSources } = await import('../src/lib/db.ts');

const HOST = 'http://127.0.0.1:8788';

/* ── Три тетрадки, от които само една е наша ──────────────────────────────── */

const CHUNKS = [
  // нашата тетрадка, избран източник
  { id: 'ok1', source_id: 's1', notebook_id: 'nb1', ordinal: 0, page: 1, locator: 'стр. 1', text: 'Наш текст едно.' },
  { id: 'ok2', source_id: 's2', notebook_id: 'nb1', ordinal: 0, page: 2, locator: 'стр. 2', text: 'Наш текст две.' },
  // нашата тетрадка, но източникът е изключен от избора
  { id: 'off', source_id: 's3', notebook_id: 'nb1', ordinal: 0, page: 1, locator: 'стр. 1', text: 'Изключен източник.' },
  // чужди тетрадки
  { id: 'foreign1', source_id: 's9', notebook_id: 'nb2', ordinal: 0, page: 1, locator: 'стр. 1', text: 'ЧУЖДО едно.' },
  { id: 'foreign2', source_id: 's8', notebook_id: 'nb3', ordinal: 0, page: 1, locator: 'стр. 1', text: 'ЧУЖДО две.' },
  // набор, на който имаме право, и набор, на който нямаме
  { id: 'ds1', source_id: 'dsrc1', notebook_id: 'dsA', ordinal: 0, page: 3, locator: 'стр. 3', text: 'Разрешен набор.' },
  { id: 'ds2', source_id: 'dsrc9', notebook_id: 'dsB', ordinal: 0, page: 1, locator: 'стр. 1', text: 'ЧУЖДО от набор.' },
];

const ALL_IDS = CHUNKS.map((c) => c.id);
const LEAKY = ['off', 'foreign1', 'foreign2'];

const src = (id, ordinal) => ({
  id, ordinal, name: `Източник ${ordinal}`, notebookId: 'nb1', kind: 'PDF', sub: '',
  originUrl: null, r2Key: null, byteSize: 0, pageCount: 0, charCount: 0,
  selected: true, status: 'ready', error: null, docName: null, createdAt: 0,
});

/** Какво връща търсенето по думи при този тест. */
let keywordHits = [];

const db = {
  prepare(sql) {
    const state = { sql, binds: [] };
    const api = {
      bind: (...b) => { state.binds = b; return api; },
      all: async () => {
        if (/FROM chunks_fts/.test(state.sql)) {
          return { results: keywordHits.map((id) => ({ chunk_id: id })) };
        }
        if (/FROM chunks WHERE id IN/.test(state.sql)) {
          const want = new Set(state.binds);
          return { results: CHUNKS.filter((c) => want.has(c.id)) };
        }
        // getChunksForSources: съзнателно ВРЪЩА и чужди редове, за да се види
        // дали readAll разчита на заявката, или сам се пази.
        if (/FROM chunks c JOIN sources s/.test(state.sql)) {
          return { results: CHUNKS };
        }
        // getSourcesByIds: източниците на пасажи от набор.
        if (/FROM sources WHERE id IN/.test(state.sql)) {
          const want = new Set(state.binds);
          return {
            results: [
              { id: 'dsrc1', notebook_id: 'dsA', ordinal: 1, kind: 'PDF', name: 'Кодекс', sub: '', origin_url: null, r2_key: null, byte_size: 0, page_count: 0, char_count: 0, selected: 1, status: 'ready', error: null, doc_name: null, created_at: 0 },
              { id: 'dsrc9', notebook_id: 'dsB', ordinal: 1, kind: 'PDF', name: 'Чужд набор', sub: '', origin_url: null, r2_key: null, byte_size: 0, page_count: 0, char_count: 0, selected: 1, status: 'ready', error: null, doc_name: null, created_at: 0 },
            ].filter((r) => want.has(r.id)),
          };
        }
        throw new Error('unexpected sql: ' + state.sql);
      },
      first: async () => null,
      run: async () => ({}),
    };
    return api;
  },
};

/** Връща всичко и НЕ спазва филтъра — най-лошият случай. */
const hostileVectorize = {
  calls: [],
  async query(_vector, opts) {
    this.calls.push(opts);
    return { matches: ALL_IDS.map((id, i) => ({ id, score: 1 - i * 0.01 })) };
  },
};

const ctx = {
  db,
  vectorize: hostileVectorize,
  ai: buildAi({
    chatModel: 'gemini-3.6-flash',
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

/** Инвариантът: нито един пасаж извън разрешените източници. */
function assertNoLeak(got, allowedSourceIds, label) {
  const allowed = new Set(allowedSourceIds);
  for (const p of got) {
    assert.ok(allowed.has(p.sourceId), `${label}: изтече източник ${p.sourceId}`);
    assert.ok(!/ЧУЖДО|Изключен/.test(p.text), `${label}: изтече текст „${p.text}“`);
  }
}

console.log('изолация между тетрадки');

/* ── retrieve ─────────────────────────────────────────────────────────────── */

const sources = [src('s1', 1), src('s2', 2)];

keywordHits = [];
let got = await retrieve(ctx, 'въпрос', sources);
assertNoLeak(got, ['s1', 's2'], 'само вектори');
assert.equal(got.length, 2, 'нашите два пасажа трябва да минат');
t('vector store returning everything cannot leak past the post-filter');

// Сега търсенето по думи връща само забраненото.
keywordHits = LEAKY;
got = await retrieve(ctx, 'въпрос', sources);
assertNoLeak(got, ['s1', 's2'], 'думи връщат забранено');
t('keyword leg returning only foreign chunks contributes nothing');

// И двете връщат само забранено → празен отговор, но без гърмеж.
keywordHits = LEAKY;
got = await retrieve(ctx, 'въпрос', [src('s1', 1)]);
assertNoLeak(got, ['s1'], 'единствен избран източник');
t('narrowing the selection narrows the result, not just the query');

/* ── Пътят с над 20 източника ─────────────────────────────────────────────── */

// Тук филтърът в индекса пада НАПЪЛНО (виж FILTER_MAX_SOURCES в rag.ts) и
// цялата тежест минава на проверката в кода. Това е най-слабото място, а с
// общите библиотеки дълъг списък източници става обичайно, не изключение.
const many = [src('s1', 1), src('s2', 2), ...Array.from({ length: 23 }, (_, i) => src(`filler${i}`, i + 3))];
keywordHits = LEAKY;
got = await retrieve(ctx, 'въпрос', many);
assertNoLeak(got, many.map((s) => s.id), 'над 20 източника');
hostileVectorize.calls = [];
await retrieve(ctx, 'въпрос', many);
assert.equal(
  hostileVectorize.calls[0].filter,
  undefined,
  'при >20 източника наистина се търси без филтър — ако това се промени, тестът трябва да се пренапише',
);
t('over 20 sources the index filter drops sourceId, and code still holds the line');

/* ── readAll (подкаст, мисловна карта, учебни материали) ──────────────────── */

// Заявката тук нарочно връща и чужди редове. Ако readAll се доверява на SQL-а
// вместо да филтрира сам, подкастът ще чете от чужда тетрадка.
const all = await readAll(ctx, sources);
assertNoLeak(all, ['s1', 's2'], 'readAll');
assert.equal(all.length, 2);
t('readAll filters by allowed source even when the query hands it foreign rows');

/* ── Празен избор ─────────────────────────────────────────────────────────── */

keywordHits = LEAKY;
assert.deepEqual(await retrieve(ctx, 'въпрос', []), []);
assert.deepEqual(await readAll(ctx, []), []);
t('no selected sources means no passages, from either path');

/* ── Набори ───────────────────────────────────────────────────────────────── */

// Хранилището пак връща ВСИЧКО, включително пасаж от набор, на който нямаме
// право. Правото се решава на едно място (allowedDatasetIds) и се подава тук;
// всичко извън подаденото трябва да отпадне, дори индексът да го е върнал.
keywordHits = [];
got = await retrieve(ctx, 'въпрос', sources, ['dsA']);
assertNoLeak(got, ['s1', 's2', 'dsrc1'], 'разрешен набор');
assert.ok(
  got.some((p) => p.text === 'Разрешен набор.'),
  'пасаж от разрешен набор трябва да мине',
);
assert.ok(
  !got.some((p) => p.text.includes('ЧУЖДО от набор')),
  'пасаж от неразрешен набор не бива да мине',
);
t('a granted dataset contributes, an ungranted one cannot');

// Без подадени набори нито един пасаж от набор не бива да влезе, дори индексът
// да ги връща — тоест изключването на набор наистина го изключва.
got = await retrieve(ctx, 'въпрос', sources, []);
assert.ok(
  !got.some((p) => /набор/.test(p.text)),
  'изключен набор не бива да участва: ' + JSON.stringify(got.map((p) => p.text)),
);
t('switching a dataset off actually removes it from the answer');

// Номерата на набора продължават след своите: иначе един чип сочи две неща.
got = await retrieve(ctx, 'въпрос', sources, ['dsA']);
const dsPassage = got.find((p) => p.sourceId === 'dsrc1');
assert.ok(dsPassage, 'пасажът от набора трябва да е тук');
assert.ok(
  dsPassage.sourceOrdinal > Math.max(...sources.map((s) => s.ordinal)),
  `номерът трябва да е след своите, а е ${dsPassage.sourceOrdinal}`,
);
t('dataset sources are numbered after the notebook own ones');

// Тетрадка без свои източници, но с набор, пак трябва да отговаря.
got = await retrieve(ctx, 'въпрос', [], ['dsA']);
assert.ok(got.length > 0, 'само набор също е валиден отговор');
assertNoLeak(got, ['dsrc1'], 'само набор');
t('a notebook with no own sources can still answer from a dataset');

/* ── Обща библиотека ──────────────────────────────────────────────────────── */

// Библиотечен източник влиза със СВОЯ ordinal от чужда тетрадка, тоест може да
// съвпадне с номер на свой източник. Съвпаднат ли, два различни източника носят
// един и същ номер в цитатите и чипът „2 · …“ сочи ту едното, ту другото.
const libraryDb = {
  prepare(sql) {
    const state = { sql, binds: [] };
    const api = {
      bind: (...b) => { state.binds = b; return api; },
      all: async () => {
        if (/FROM sources WHERE notebook_id/.test(state.sql)) {
          return { results: [
            { id: 'own1', notebook_id: 'nb1', ordinal: 1, kind: 'PDF', name: 'Мой', sub: '', origin_url: null, r2_key: null, byte_size: 0, page_count: 0, char_count: 0, selected: 1, status: 'ready', error: null, doc_name: null, created_at: 0 },
            { id: 'own2', notebook_id: 'nb1', ordinal: 2, kind: 'PDF', name: 'Мой 2', sub: '', origin_url: null, r2_key: null, byte_size: 0, page_count: 0, char_count: 0, selected: 1, status: 'ready', error: null, doc_name: null, created_at: 0 },
          ] };
        }
        if (/notebook_library_sources/.test(state.sql)) {
          // Идва с ordinal 1 и 2 — същите като своите.
          return { results: [
            { id: 'lib1', notebook_id: 'libNb', ordinal: 1, kind: 'PDF', name: 'Учебник', sub: '', origin_url: null, r2_key: null, byte_size: 0, page_count: 0, char_count: 0, selected: 1, status: 'ready', error: null, doc_name: null, created_at: 0 },
            { id: 'lib2', notebook_id: 'libNb', ordinal: 2, kind: 'PDF', name: 'Сборник', sub: '', origin_url: null, r2_key: null, byte_size: 0, page_count: 0, char_count: 0, selected: 1, status: 'ready', error: null, doc_name: null, created_at: 0 },
          ] };
        }
        throw new Error('unexpected sql: ' + state.sql);
      },
      first: async () => null,
      run: async () => ({}),
    };
    return api;
  },
};

const merged = await listAllowedSources(libraryDb, 'student', 'nb1');
assert.deepEqual(merged.map((s) => s.id), ['own1', 'own2', 'lib1', 'lib2']);
assert.deepEqual(merged.map((s) => s.ordinal), [1, 2, 3, 4], 'номерата не бива да се повтарят');
t('library sources are renumbered after the notebook own ones');

console.log('\n' + pass + ' checks passed');
