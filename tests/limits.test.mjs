import assert from 'node:assert/strict';

const {
  getEntitlement, getUsage, saveSubscription, assertCanCreateNotebook,
  assertCanAsk, assertCanMakeAudio, countQuestion, countAudio,
  markEventProcessed, findUserByCustomerId, QuotaError, adminSetPlan,
} = await import('../src/lib/limits.ts');
const { currentPeriod, PLANS, BUSINESS } = await import('../src/lib/plans.ts');
const { setOrgSeats } = await import('../src/lib/orgs.ts');

/* ── A tiny in-memory stand-in for the bits of D1 that limits.ts uses ────── */

function makeDb() {
  const subs = new Map();          // userId -> row
  const counters = new Map();      // `${user}|${period}` -> {questions, audio}
  const notebooks = new Map();     // userId -> count
  const events = new Set();
  const orgs = new Map();          // orgId -> {seats}
  const orgMembers = new Set();    // `${orgId}|${userId}`
  const orgCounters = new Map();   // `${orgId}|${period}` -> questions

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
    if (s.startsWith('SELECT o.id AS org_id')) {
      const [period, user] = binds;
      const results = [];
      for (const [id, org] of orgs) {
        if (org.seats > 0 && orgMembers.has(`${id}|${user}`)) {
          results.push({ org_id: id, seats: org.seats, used: orgCounters.get(`${id}|${period}`) ?? 0 });
        }
      }
      results.sort((a, b) => (a.org_id < b.org_id ? -1 : 1));
      return { all: results };
    }
    if (s.startsWith('INSERT INTO org_usage_counters')) {
      const key = `${binds[0]}|${binds[1]}`;
      orgCounters.set(key, (orgCounters.get(key) ?? 0) + 1);
      return { run: { meta: { changes: 1 } } };
    }
    if (s.startsWith('UPDATE organizations SET seats')) {
      const [seats, id] = binds;
      const org = orgs.get(id);
      if (!org) return { run: { meta: { changes: 0 } } };
      org.seats = seats;
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
        all: async () => ({ results: run(sql, binds).all ?? [] }),
      };
      return api;
    },
    // test helpers
    setNotebooks: (user, n) => notebooks.set(user, n),
    setOrg: (id, seats) => orgs.set(id, { seats }),
    getOrgSeats: (id) => orgs.get(id)?.seats,
    addMember: (org, user) => orgMembers.add(`${org}|${user}`),
    setOrgUsed: (org, period, n) => orgCounters.set(`${org}|${period}`, n),
    orgUsed: (org, period) => orgCounters.get(`${org}|${period}`) ?? 0,
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
assert.equal(ent.plan.limits.questionsPerMonth, 1000);
t('a saved subscription grants its plan');

// Нарочно е false и при трите плана, а не пропуск: по-скъпият модел няма СВОЙ
// брояч, тоест платен потребител може да мине целия си таван по него и да излезе
// по-скъп от абонамента си. Върне ли се на true, това пак става възможно.
for (const id of ['free', 'plus', 'pro']) {
  assert.equal(PLANS[id].limits.proModel, false, id);
}
t('no plan unlocks the pricier model while it has no counter of its own');

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

// Броят идва от плана — тестът не бива да го дублира като литерал.
const freeAudio = PLANS.free.limits.audioPerMonth;
for (let i = 0; i < freeAudio; i++) await countAudio(db, U);
await assertCanMakeAudio(db, U).then(
  () => { throw new Error('очаквах отказ след изчерпан таван'); },
  () => {},
);
t(`the free plan allows exactly ${freeAudio} audio overviews per month`);

// Counters are keyed by month, so a new month starts clean without a reset job.
usage = await getUsage(db, U);
assert.equal(usage.audio, freeAudio);
assert.equal((await getUsage(db, 'u_other')).questions, 0);
t('counters are per user and per month');

console.log('\nbusiness org pools');
db = makeDb();
db.setOrg('org_1', 2); // 2 места × 300 = 600 въпроса в пакета
db.addMember('org_1', U);

let payer = await assertCanAsk(db, U);
assert.deepEqual(payer, { via: 'personal' });
t('with personal quota left the personal plan pays, org membership or not');

for (let i = 0; i < PLANS.free.limits.questionsPerMonth; i++) await countQuestion(db, U);
payer = await assertCanAsk(db, U);
assert.deepEqual(payer, { via: 'org', orgId: 'org_1' });
t('an exhausted personal quota falls over to the org pool');

await countQuestion(db, U, payer);
assert.equal(db.orgUsed('org_1', currentPeriod()), 1);
assert.equal((await getUsage(db, U)).questions, PLANS.free.limits.questionsPerMonth);
t('an org-paid question hits the org counter, not the personal one');

db.setOrgUsed('org_1', currentPeriod(), 2 * BUSINESS.questionsPerSeat);
await assert.rejects(() => assertCanAsk(db, U), /пакет на организацията/);
t('a drained pool refuses with a message naming the org pool');

// Член на организация БЕЗ платени места не вижда никакъв пакет.
db.setOrg('org_free', 0);
db.addMember('org_free', 'u_lone');
for (let i = 0; i < PLANS.free.limits.questionsPerMonth; i++) await countQuestion(db, 'u_lone');
await assert.rejects(() => assertCanAsk(db, 'u_lone'), (err) => {
  assert.ok(err instanceof QuotaError);
  assert.doesNotMatch(err.message, /организаци/);
  return true;
});
t('an unpaid org grants no pool and the refusal does not mention one');

console.log('\nadmin plan control');
db = makeDb();
await adminSetPlan(db, U, 'pro');
assert.equal((await getEntitlement(db, U)).plan.id, 'pro');
t('an admin-set plan grants entitlement without Stripe ids');

await adminSetPlan(db, U, 'free');
assert.equal((await getEntitlement(db, U)).plan.id, 'free');
t('setting free takes a manual plan away');

await saveSubscription(db, U, {
  plan: 'plus', status: 'active', interval: 'month',
  stripeCustomerId: 'cus_9', stripeSubscriptionId: 'sub_9',
  currentPeriodEnd: Date.now() + 30 * 86_400_000, cancelAtPeriodEnd: false,
});
await assert.rejects(() => adminSetPlan(db, U, 'pro'), /Stripe/);
assert.equal((await getEntitlement(db, U)).plan.id, 'plus');
t('a live Stripe subscription refuses the manual override');

await saveSubscription(db, U, {
  plan: 'plus', status: 'canceled', interval: 'month',
  stripeCustomerId: 'cus_9', stripeSubscriptionId: 'sub_9',
  currentPeriodEnd: Date.now() - 86_400_000, cancelAtPeriodEnd: false,
});
await adminSetPlan(db, U, 'pro');
assert.equal((await getEntitlement(db, U)).plan.id, 'pro');
t('a dead Stripe subscription no longer blocks a manual plan');

console.log('\norg seats');
db = makeDb();
db.setOrg('org_1', 0);
await setOrgSeats(db, 'org_1', 12);
assert.equal(db.getOrgSeats('org_1'), 12);
await setOrgSeats(db, 'org_1', 0);
assert.equal(db.getOrgSeats('org_1'), 0);
t('seats can be granted and taken back');

for (const bad of [2.5, -1, 10_001, Number.NaN]) {
  await assert.rejects(() => setOrgSeats(db, 'org_1', bad), /цяло число/);
}
await assert.rejects(() => setOrgSeats(db, 'org_nope', 5), /организация/);
t('seats validate as a bounded integer and an unknown org is refused');

console.log('\nwebhook idempotency');
db = makeDb();
assert.equal(await markEventProcessed(db, 'evt_1', 'x'), true);
assert.equal(await markEventProcessed(db, 'evt_1', 'x'), false);
assert.equal(await markEventProcessed(db, 'evt_2', 'x'), true);
t('an event is processed once, replays are ignored');

console.log('\n' + pass + ' checks passed');
