import assert from 'node:assert/strict';

const {
  getEntitlement, getUsage, saveSubscription, assertCanCreateNotebook,
  assertCanAsk, assertCanMakeAudio, countQuestion, countAudio,
  markEventProcessed, findUserByCustomerId, QuotaError,
} = await import('../src/lib/limits.ts');
const { currentPeriod } = await import('../src/lib/plans.ts');

/* ── A tiny in-memory stand-in for the bits of D1 that limits.ts uses ────── */

function makeDb() {
  const subs = new Map();          // userId -> row
  const counters = new Map();      // `${user}|${period}` -> {questions, audio}
  const notebooks = new Map();     // userId -> count
  const events = new Set();

  function run(sql, binds) {
    const s = sql.replace(/\s+/g, ' ').trim();

    if (s.startsWith('SELECT plan, status, interval')) {
      return { first: subs.get(binds[0]) ?? null };
    }
    if (s.startsWith('SELECT questions, audio FROM usage_counters')) {
      return { first: counters.get(`${binds[0]}|${binds[1]}`) ?? null };
    }
    if (s.startsWith('SELECT COUNT(*) AS c FROM notebooks')) {
      return { first: { c: notebooks.get(binds[0]) ?? 0 } };
    }
    if (s.startsWith('INSERT INTO subscriptions')) {
      const [user_id, plan, status, interval, cust, sub, end, cancel] = binds;
      const prev = subs.get(user_id);
      subs.set(user_id, {
        plan, status, interval,
        stripe_customer_id: cust ?? prev?.stripe_customer_id ?? null,
        stripe_subscription_id: sub,
        current_period_end: end,
        cancel_at_period_end: cancel,
      });
      return { run: { meta: { changes: 1 } } };
    }
    if (s.startsWith('INSERT INTO usage_counters')) {
      const column = /INSERT INTO usage_counters \(user_id, period, (\w+)\)/.exec(s)[1];
      const key = `${binds[0]}|${binds[1]}`;
      const row = counters.get(key) ?? { questions: 0, audio: 0 };
      row[column] += 1;
      counters.set(key, row);
      return { run: { meta: { changes: 1 } } };
    }
    if (s.startsWith('SELECT user_id FROM subscriptions WHERE stripe_customer_id')) {
      for (const [user, row] of subs) {
        if (row.stripe_customer_id === binds[0]) return { first: { user_id: user } };
      }
      return { first: null };
    }
    if (s.startsWith('INSERT INTO stripe_events')) {
      if (events.has(binds[0])) throw new Error('UNIQUE constraint failed');
      events.add(binds[0]);
      return { run: { meta: { changes: 1 } } };
    }
    throw new Error('unexpected sql: ' + s);
  }

  const db = {
    prepare(sql) {
      let binds = [];
      const api = {
        bind: (...b) => { binds = b; return api; },
        first: async () => run(sql, binds).first ?? null,
        run: async () => run(sql, binds).run ?? { meta: { changes: 0 } },
        all: async () => ({ results: [] }),
      };
      return api;
    },
    // test helpers
    setNotebooks: (user, n) => notebooks.set(user, n),
  };
  return db;
}

let pass = 0;
const t = (name) => { pass++; console.log('  ok  ' + name); };
const U = 'u_test';

console.log('entitlement');
let db = makeDb();
let ent = await getEntitlement(db, U);
assert.equal(ent.plan.id, 'free');
assert.equal(ent.status, 'active');
t('no subscription row means the free plan');

await saveSubscription(db, U, {
  plan: 'plus', status: 'active', interval: 'year',
  stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
  currentPeriodEnd: Date.now() + 30 * 86_400_000, cancelAtPeriodEnd: false,
});
ent = await getEntitlement(db, U);
assert.equal(ent.plan.id, 'plus');
assert.equal(ent.interval, 'year');
assert.equal(ent.plan.limits.proModel, true);
t('a saved subscription grants its plan');

// past_due still counts as paid — a failed card must not lock people out at once.
await saveSubscription(db, U, {
  plan: 'plus', status: 'past_due', interval: 'month',
  stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
  currentPeriodEnd: Date.now() + 5 * 86_400_000, cancelAtPeriodEnd: false,
});
assert.equal((await getEntitlement(db, U)).plan.id, 'plus');
t('past_due keeps access (grace period, not instant lockout)');

await saveSubscription(db, U, {
  plan: 'plus', status: 'canceled', interval: 'month',
  stripeCustomerId: 'cus_1', stripeSubscriptionId: null,
  currentPeriodEnd: Date.now() - 86_400_000, cancelAtPeriodEnd: false,
});
assert.equal((await getEntitlement(db, U)).plan.id, 'free');
t('canceled falls back to free');

// A stale "active" row whose period ended long ago must not grant access.
await saveSubscription(db, U, {
  plan: 'pro', status: 'active', interval: 'month',
  stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1',
  currentPeriodEnd: Date.now() - 10 * 86_400_000, cancelAtPeriodEnd: false,
});
assert.equal((await getEntitlement(db, U)).plan.id, 'free');
t('an expired period falls back to free even if status says active');

assert.equal(await findUserByCustomerId(db, 'cus_1'), U);
assert.equal(await findUserByCustomerId(db, 'cus_nope'), null);
t('customer id maps back to the user (needed by the webhook)');

console.log('\nquotas');
db = makeDb();
db.setNotebooks(U, 2);
await assertCanCreateNotebook(db, U);
t('under the free notebook cap is allowed');

db.setNotebooks(U, 3);
await assert.rejects(() => assertCanCreateNotebook(db, U), (err) => {
  assert.ok(err instanceof QuotaError);
  assert.equal(err.status, 402);
  assert.match(err.message, /3 тетрадки/);
  return true;
});
t('at the cap it throws 402 with a message naming the limit');

// Paid plan lifts it without any code change at the call site.
await saveSubscription(db, U, {
  plan: 'pro', status: 'active', interval: 'month',
  stripeCustomerId: 'cus_2', stripeSubscriptionId: 'sub_2',
  currentPeriodEnd: Date.now() + 86_400_000, cancelAtPeriodEnd: false,
});
db.setNotebooks(U, 500);
await assertCanCreateNotebook(db, U);
t('Pro has no notebook ceiling');

console.log('\nusage counting');
db = makeDb();
for (let i = 0; i < 50; i++) await countQuestion(db, U);
let usage = await getUsage(db, U);
assert.equal(usage.questions, 50);
assert.equal(usage.period, currentPeriod());
await assert.rejects(() => assertCanAsk(db, U), /50 въпроса/);
t('questions count up and the 51st is refused');

await countAudio(db, U);
await assert.rejects(() => assertCanMakeAudio(db, U), /един аудио преглед/);
t('the free plan allows exactly one audio overview per month');

// Counters are keyed by month, so a new month starts clean without a reset job.
usage = await getUsage(db, U);
assert.equal(usage.audio, 1);
assert.equal((await getUsage(db, 'u_other')).questions, 0);
t('counters are per user and per month');

console.log('\nwebhook idempotency');
db = makeDb();
assert.equal(await markEventProcessed(db, 'evt_1', 'x'), true);
assert.equal(await markEventProcessed(db, 'evt_1', 'x'), false);
assert.equal(await markEventProcessed(db, 'evt_2', 'x'), true);
t('an event is processed once, replays are ignored');

console.log('\n' + pass + ' checks passed');
