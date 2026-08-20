import assert from 'node:assert/strict';

const { renderMarkdown } = await import('../src/lib/markdown.ts');
const { splitIntoPassages, decodeEntities, normalizeWhitespace } = await import('../src/lib/extract/html.ts');
const { parseTurns, groupTurns } = await import('../src/lib/studio.ts');
const { extractCitations, stripCitationMarkers, citationLabel, shortName } = await import('../src/lib/rag.ts');
const { pcmToWav, pcmDuration, formatDuration, concatPcm } = await import('../src/lib/audio/wav.ts');
const { translateGoogleError } = await import('../src/lib/gemini.ts');
const { describeThinExtraction } = await import('../src/lib/ingest.ts');
const { STUDIO_TASKS, USE_CASES, tilesFor } = await import('../src/lib/prompts.ts');
const { isAdmin } = await import('../src/lib/datasets.ts');
const { missingMigrations } = await import('../src/lib/migrations.ts');
const { EXPECTED_MIGRATIONS } = await import('../src/lib/migrations.gen.ts');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('markdown');
t('escapes HTML from model/document text', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> и **важно**');
  assert.ok(!html.includes('<img'), 'raw tag leaked: ' + html);
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('<strong>важно</strong>'));
});
t('headings, lists, code', () => {
  assert.equal(renderMarkdown('## Цели'), '<h3>Цели</h3>');
  assert.equal(renderMarkdown('- а\n- б'), '<ul><li>а</li><li>б</li></ul>');
  assert.equal(renderMarkdown('1. а\n2. б'), '<ol><li>а</li><li>б</li></ol>');
  assert.ok(renderMarkdown('`код`').includes('<code>код</code>'));
});
t('italics do not eat bold', () => {
  assert.equal(renderMarkdown('**а** и *б*'), '<p><strong>а</strong> и <em>б</em></p>');
});

console.log('citations');
const passages = [
  { index: 1, sourceId: 's1', sourceOrdinal: 1, sourceName: 'Зелена сделка.pdf', locator: 'стр. 12', text: 'алфа', score: 1 },
  { index: 2, sourceId: 's2', sourceOrdinal: 4, sourceName: 'Fit for 55 — резюме.pdf', locator: 'стр. 3', text: 'бета', score: 1 },
  { index: 3, sourceId: 's3', sourceOrdinal: 5, sourceName: 'Дебат в ЕП', locator: '34:12', text: 'гама', score: 1 },
];
t('label matches the design format', () => {
  assert.equal(citationLabel(passages[0]), '1 · Зелена сделка, стр. 12');
  assert.equal(citationLabel(passages[2]), '5 · Дебат в ЕП, 34:12');
});
t('only cited passages become chips, in order of first use', () => {
  const r = extractCitations('Първо [2]. После [1] и пак [2]. Край [3].', passages);
  assert.deepEqual(r.citations.map((c) => c.label), [
    '4 · Fit for 55 — резюме, стр. 3',
    '1 · Зелена сделка, стр. 12',
    '5 · Дебат в ЕП, 34:12',
  ]);
  assert.equal(r.text, 'Първо. После и пак. Край.');
});
t('grouped markers [1,3] both count', () => {
  const r = extractCitations('Twierdzenie [1, 3].', passages);
  assert.deepEqual(r.citations.map((c) => c.ordinal), [1, 2]);
});
t('markers pointing nowhere are dropped, text still cleaned', () => {
  const r = extractCitations('Нещо [9].', passages);
  assert.equal(r.citations.length, 0);
  assert.equal(r.text, 'Нещо.');
});
t('punctuation is not orphaned', () => {
  assert.equal(stripCitationMarkers('Да [1], после [2]!'), 'Да, после!');
});
t('shortName strips extensions', () => {
  assert.equal(shortName('Бележки от лекция 4.docx'), 'Бележки от лекция 4');
});

console.log('podcast script');
const script = `Ния: Добре, да започнем от числата.
Стефан: Да, и те не се връзват.
**Ния:** Чакай — кой документ казва 2038?
(смее се)
Стефан: Планът за преход.
продължава изречението тук`;
t('parses both speakers, bold names, and continuations', () => {
  const turns = parseTurns(script);
  assert.deepEqual(turns.map((x) => x.speaker), ['Ния', 'Стефан', 'Ния', 'Стефан']);
  assert.equal(turns[2].text, 'Чакай — кой документ казва 2038?');
  assert.ok(turns[3].text.endsWith('продължава изречението тук'), turns[3].text);
});
t('groups keep both voices per TTS segment', () => {
  const turns = Array.from({ length: 40 }, (_, i) => ({
    speaker: i % 2 ? 'Стефан' : 'Ния',
    text: 'Реплика номер ' + i + ' с достатъчно текст, за да напълни сегмента бързо.',
  }));
  const groups = groupTurns(turns, 600);
  assert.ok(groups.length > 1, 'expected several segments');
  for (const g of groups) assert.ok(g.length <= 700, 'segment too long: ' + g.length);
  assert.equal(groups.join('\n').split('\n').length, 40);
});
t('ignores stage directions and headings', () => {
  const turns = parseTurns('# Заглавие\n[музика]\nНия: Само това е реплика.');
  assert.equal(turns.length, 1);
  assert.equal(turns[0].text, 'Само това е реплика.');
});

console.log('passages');
t('splits on headings and keeps locators', () => {
  const text = '## Цели за 2030\n\n' + 'а'.repeat(1500) + '\n\n## Финансиране\n\n' + 'б'.repeat(200);
  const ps = splitIntoPassages(text);
  assert.ok(ps.length >= 2, JSON.stringify(ps.map((p) => p.locator)));
  assert.ok(ps[0].locator.includes('Цели за 2030'));
  assert.ok(ps[ps.length - 1].locator.includes('Финансиране'));
});
t('decodes entities incl. Bulgarian quotes', () => {
  assert.equal(decodeEntities('&bdquo;тест&ldquo; &amp; &#1073;'), '„тест“ & б');
});
t('normalizes nbsp and runs of blank lines', () => {
  assert.equal(normalizeWhitespace('а  б\n\n\n\nв'), 'а б\n\nв');
});

console.log('wav');
t('header is a valid 24kHz mono PCM WAV', () => {
  const pcm = new Uint8Array(48000 * 2); // 2s at 24k, 16-bit
  const wav = pcmToWav(pcm, { sampleRate: 24000 });
  const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF');
  assert.equal(String.fromCharCode(...wav.subarray(8, 12)), 'WAVE');
  assert.equal(dv.getUint32(4, true), 36 + pcm.length);
  assert.equal(dv.getUint16(20, true), 1);        // PCM
  assert.equal(dv.getUint16(22, true), 1);        // mono
  assert.equal(dv.getUint32(24, true), 24000);    // sample rate
  assert.equal(dv.getUint32(28, true), 48000);    // byte rate
  assert.equal(dv.getUint16(32, true), 2);        // block align
  assert.equal(dv.getUint16(34, true), 16);       // bits
  assert.equal(dv.getUint32(40, true), pcm.length);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(pcmDuration(pcm.length, 24000), 2);
});
t('concat preserves order and length', () => {
  const out = concatPcm([new Uint8Array([1, 2]), new Uint8Array([3])]);
  assert.deepEqual([...out], [1, 2, 3]);
});
t('formats durations like the design', () => {
  assert.equal(formatDuration(744), '12:24');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(281), '4:41');
});

console.log('\ngoogle errors');
// Съобщенията съдържат и латиница („Gemini API“, имена на променливи), затова
// проверката е за наличие на български текст, не за първата буква.
const bg = (s) => /[А-Яа-я]{4,}/.test(s);
t('the invalid-key message a user actually sees is Bulgarian and actionable', () => {
  // Точният текст, който Google върна на потребителя при добавяне на източник.
  const out = translateGoogleError(400, 'API key not valid. Please pass a valid API key.');
  assert.ok(bg(out), out);
  assert.ok(out.includes('ключът'), out);
  assert.ok(!/API key not valid/.test(out), out);
});
t('names the fix for a disabled API and for a restricted key', () => {
  assert.ok(
    translateGoogleError(
      403,
      'Generative Language API has not been used in project 123 before or it is disabled.',
    ).includes('Google Cloud Console'),
  );
  assert.ok(
    translateGoogleError(403, 'Requests to this API are blocked.').includes('ограниченията'),
  );
});
t('quota and unknown-model cases do not fall through to English', () => {
  assert.ok(bg(translateGoogleError(429, 'Quota exceeded for quota metric')));
  assert.ok(translateGoogleError(404, 'models/gemini-9 is not found').includes('CHAT_MODEL'));
});
t('a model retired for new keys says where to change it and why not the dashboard', () => {
  // Точният текст от Google, след като 2.5 беше изтеглен за нови ключове.
  const out = translateGoogleError(
    400,
    'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use a newer model for the latest features and improvements.',
  );
  assert.ok(bg(out), out);
  assert.ok(out.includes('wrangler.jsonc'), 'трябва да каже КЪДЕ се сменя');
  assert.ok(out.includes('/api/models'), 'и как се разбира кой модел работи');
  // Оригиналът остава в края: името на изтегления модел е в него.
  assert.ok(out.includes('gemini-2.5-flash'), out);
});
t('an unrecognised message is passed through rather than swallowed', () => {
  assert.equal(translateGoogleError(400, 'Something entirely new'), 'Something entirely new');
});

console.log('миграции');
t('the base behind the code is named precisely, not just detected', () => {
  const expected = ['0001.sql', '0002.sql', '0003.sql'];
  assert.deepEqual(missingMigrations(expected, ['0001.sql', '0002.sql', '0003.sql']), []);
  assert.deepEqual(missingMigrations(expected, ['0001.sql', '0002.sql']), ['0003.sql']);
  // Прясна база: няма нищо приложено — липсва всичко, не гърми.
  assert.deepEqual(missingMigrations(expected, []), expected);
  // Записана в повече (примерно от стара инсталация) не бърка сметката.
  assert.deepEqual(missingMigrations(expected, [...expected, '9999_old.sql']), []);
});

// Ако някой добави миграция и не пусне build-а, това е мястото, което ще
// изкрещи — иначе защитата в middleware пази СТАРИЯ списък и пропуска новата.
const { readdirSync } = await import('node:fs');
const onDisk = readdirSync(new URL('../migrations', import.meta.url))
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort();
t('the generated list matches the migrations folder', () => {
  assert.deepEqual(EXPECTED_MIGRATIONS, onDisk);
});

console.log('админ достъп');
t('admin is a list of emails, matched case- and space-insensitively', () => {
  const env = { ADMIN_EMAILS: ' Rado@zapiski.bg , second@zapiski.bg ' };
  assert.equal(isAdmin(env, 'rado@zapiski.bg'), true);
  assert.equal(isAdmin(env, '  RADO@ZAPISKI.BG  '), true, 'имейлът идва от базата, може да носи празни места');
  assert.equal(isAdmin(env, 'second@zapiski.bg'), true);
});

t('nobody is admin when the variable is missing or empty', () => {
  // Най-важният случай: незададена променлива не бива да значи „всички са админи“.
  for (const env of [{}, { ADMIN_EMAILS: '' }, { ADMIN_EMAILS: '   ' }, { ADMIN_EMAILS: ',,' }]) {
    assert.equal(isAdmin(env, 'rado@zapiski.bg'), false, JSON.stringify(env));
  }
});

t('a user without an email is never admin', () => {
  // Профил само с Google може да няма имейл; null не бива да съвпадне с нищо.
  assert.equal(isAdmin({ ADMIN_EMAILS: 'rado@zapiski.bg' }, null), false);
  assert.equal(isAdmin({ ADMIN_EMAILS: 'rado@zapiski.bg' }, ''), false);
});

console.log('материали по употреба');
t('every profile gets exactly four tiles, all of them real tasks', () => {
  // Сгрешен ключ не гърми — плочката просто се показва празна, защото
  // STUDIO_TASKS[key] е undefined. Затова се проверява, че всеки съществува.
  for (const useCase of ['', 'study', 'legal', 'research', 'work', 'нещо-друго']) {
    const tiles = tilesFor(useCase);
    assert.equal(tiles.length, 4, useCase);
    for (const key of tiles) {
      assert.ok(STUDIO_TASKS[key], `${useCase}: няма задача „${key}“`);
      assert.ok(STUDIO_TASKS[key].title, `${useCase}: задачата „${key}“ е без заглавие`);
    }
  }
});

t('the exam and study-guide pair shows up only for studying', () => {
  // Точно това видя юристът и реши, че приложението не е за него.
  assert.ok(tilesFor('study').includes('exam'));
  assert.ok(tilesFor('study').includes('study_guide'));
  for (const other of ['', 'legal', 'research', 'work']) {
    assert.ok(!tilesFor(other).includes('exam'), other);
    assert.ok(!tilesFor(other).includes('study_guide'), other);
  }
});

t('each profile has one tile the others do not', () => {
  const special = { study: 'exam', legal: 'obligations', research: 'review', work: 'actions' };
  for (const [useCase, key] of Object.entries(special)) {
    assert.ok(tilesFor(useCase).includes(key), `${useCase} → ${key}`);
    for (const other of Object.keys(special)) {
      if (other !== useCase) assert.ok(!tilesFor(other).includes(key), `${other} не бива да има ${key}`);
    }
  }
});

t('an unknown value falls back to the neutral set, not to nothing', () => {
  // Стойността идва от базата; стар или подправен ред не бива да оставя студиото празно.
  assert.deepEqual(tilesFor('какво-е-това'), tilesFor(''));
  assert.deepEqual(tilesFor(undefined), tilesFor(''));
});

t('every offered profile is actually handled', () => {
  // Добавен избор в USE_CASES без клон в tilesFor значи човек, който избира нещо
  // и получава общите материали, без да разбере защо.
  for (const u of USE_CASES) {
    assert.notDeepEqual(tilesFor(u.value), tilesFor(''), u.value);
  }
});

console.log('празни източници');
t('a JS-rendered page is refused instead of becoming an empty source', () => {
  // Точният случай, който изглежда като счупен чат: страницата се сглобява в
  // браузъра, извличането вижда само обвивката, източникът става „готов“ с нула
  // пасажа и после на всеки въпрос отговорът е „в източниците няма отговор“.
  const out = describeThinExtraction('WEB', 1, 80);
  assert.ok(out, 'тънка уеб страница трябва да се откаже');
  assert.ok(out.includes('JavaScript'), 'трябва да каже защо: ' + out);
  assert.ok(out.includes('Текст'), 'и какво да направи човекът: ' + out);
});
t('a real page passes', () => {
  assert.equal(describeThinExtraction('WEB', 12, 9000), null);
});
t('other kinds are refused only when truly empty', () => {
  // Къс текст в бележка е нарочен и не бива да се отказва.
  assert.equal(describeThinExtraction('TXT', 1, 90), null);
  assert.ok(describeThinExtraction('PDF', 0, 0));
  assert.ok(describeThinExtraction('TXT', 0, 0));
});

console.log('\n' + pass + ' assertions passed');
