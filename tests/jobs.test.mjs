import assert from 'node:assert/strict';

const { isJobStale, JOB_STALE_MS } = await import('../src/lib/db.ts');
const { scriptTokenBudget } = await import('../src/lib/studio.ts');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

const NOW = 1_800_000_000_000;
const job = (over) => ({
  id: 'job_1', kind: 'audio', status: 'running', step: 'Пиша сценария…',
  progress: 15, durationS: 0, error: null, ...over,
});

console.log('stale studio jobs');

t('a running job that stopped reporting progress is stale', () => {
  // Точният симптом: спира на 15% и върти вечно, защото изолата е прекратена и
  // никой не е записал „error“.
  assert.equal(isJobStale(job({ updatedAt: NOW - JOB_STALE_MS - 1 }), NOW), true);
});

t('a job that reported progress recently is not stale', () => {
  assert.equal(isJobStale(job({ updatedAt: NOW - 5_000 }), NOW), false);
  assert.equal(isJobStale(job({ updatedAt: NOW - JOB_STALE_MS + 1_000 }), NOW), false);
});

t('finished jobs are never stale, however old', () => {
  // Иначе готов подкаст от миналата седмица щеше да се маркира като провален.
  for (const status of ['done', 'error']) {
    assert.equal(isJobStale(job({ status, updatedAt: NOW - 9e8 }), NOW), false, status);
  }
});

t('a queued job counts too — it can die before it ever starts', () => {
  assert.equal(isJobStale(job({ status: 'queued', updatedAt: NOW - JOB_STALE_MS - 1 }), NOW), true);
});

t('a job with no timestamp is left alone rather than guessed at', () => {
  assert.equal(isJobStale(job({ updatedAt: undefined }), NOW), false);
});

t('the window is long enough for one slow script generation', () => {
  assert.ok(JOB_STALE_MS >= 120_000, 'под 2 минути би отписвало живи задачи');
});

console.log('\nscript budget');

t('the token cap tracks the requested length instead of a flat 16k', () => {
  // Изходните токени се генерират серийно, тоест таванът е и таван на времето.
  assert.ok(scriptTokenBudget(3) < scriptTokenBudget(12));
  assert.ok(scriptTokenBudget(12) <= 8000, 'таванът не бива да расте без граница');
  assert.ok(scriptTokenBudget(3) >= 1500, 'но и да не задушава кратък подкаст');
  assert.ok(scriptTokenBudget(8) < 16_000, 'старата стойност беше 16 000');
});

console.log('\n' + pass + ' checks passed');
