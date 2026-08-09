import assert from 'node:assert/strict';

const {
  hashPassword, verifyPassword, passwordProblem, isValidEmail,
  normalizeEmail, nameFromEmail, initialsOf,
} = await import('../src/lib/auth.ts');
const { Stripe } = await import('../src/lib/stripe.ts');
const {
  PLANS, planFromPriceId, priceIdFor, formatPrice, monthlyEquivalent, currentPeriod, planOf,
} = await import('../src/lib/plans.ts');
const { safeNext } = await import('../src/lib/authApi.ts');
const { createHmac } = await import('node:crypto');

let pass = 0;
const t = (name) => { pass++; console.log('  ok  ' + name); };

console.log('passwords');
const hash = await hashPassword('правилна-парола-42');
assert.match(hash, /^pbkdf2\$sha256\$210000\$[\w-]+\$[\w-]+$/);
t('hash carries its own algorithm and iteration count');

assert.equal(await verifyPassword('правилна-парола-42', hash), true);
assert.equal(await verifyPassword('грешна-парола-42', hash), false);
assert.equal(await verifyPassword('', hash), false);
t('verifies the right password and rejects wrong ones');

const other = await hashPassword('правилна-парола-42');
assert.notEqual(other, hash, 'same password must not produce the same hash');
assert.equal(await verifyPassword('правилна-парола-42', other), true);
t('salted: identical passwords hash differently, both verify');

for (const bad of ['', 'кратка', 'pbkdf2$sha256$0$a$b', 'not-a-hash', 'pbkdf2$md5$1000$a$b']) {
  assert.equal(await verifyPassword('правилна-парола-42', bad), false, 'accepted junk: ' + bad);
}
t('malformed stored hashes are rejected, never accepted');

// An older, cheaper hash must still verify — that is the point of the format.
const legacy = await (async () => {
  const src = await import('../src/lib/auth.ts');
  // Build a 1000-iteration hash by hand using the same scheme.
  const salt = new Uint8Array(16).fill(7);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('пароланасила'), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' }, key, 256);
  const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  void src;
  return `pbkdf2$sha256$1000$${b64(salt)}$${b64(bits)}`;
})();
assert.equal(await verifyPassword('пароланасила', legacy), true);
t('an older iteration count still verifies (upgradeable format)');

console.log('\nvalidation');
assert.equal(passwordProblem('123456789'), 'Паролата трябва да е поне 10 знака.');
assert.equal(passwordProblem(' парола123456'), 'Паролата не може да започва или свършва с празно място.');
assert.equal(passwordProblem('достатъчно-дълга'), null);
t('password rules');

for (const good of ['a@b.bg', 'radoslav.dodnikov@outlook.com', 'x+y@sub.example.co.uk']) {
  assert.equal(isValidEmail(good), true, good);
}
for (const bad of ['', 'a@b', 'no-at-sign.bg', 'a b@c.bg', 'a@@b.bg', '@b.bg']) {
  assert.equal(isValidEmail(bad), false, bad);
}
t('email rules');

assert.equal(normalizeEmail('  RadoSlav@Example.BG '), 'radoslav@example.bg');
assert.equal(nameFromEmail('radoslav.dodnikov@outlook.com'), 'Radoslav Dodnikov');
assert.equal(initialsOf('Радослав Дойников'), 'РД');
assert.equal(initialsOf('Радослав'), 'РА');
t('normalisation and derived name/initials');

console.log('\nopen redirect');
for (const bad of ['//evil.example', 'https://evil.example', 'javascript:alert(1)', null, '']) {
  assert.equal(safeNext(bad), '/app', 'allowed: ' + bad);
}
assert.equal(safeNext('/app/notebook/nb_1'), '/app/notebook/nb_1');
t('only internal paths survive safeNext');

console.log('\nplans');
assert.equal(PLANS.free.limits.notebooks, 3);
assert.equal(planOf('nonsense').id, 'free');
assert.equal(planOf('pro').id, 'pro');
t('unknown plan ids fall back to free');

assert.equal(formatPrice(900), '€9');
assert.equal(formatPrice(1950), '€19,50');
assert.equal(monthlyEquivalent(PLANS.plus), '€7,50');
t('price formatting: ' + [formatPrice(900), formatPrice(1950), monthlyEquivalent(PLANS.plus)].join(' | '));

// Yearly must actually be cheaper per month than monthly, or the copy lies.
for (const id of ['plus', 'pro']) {
  const p = PLANS[id];
  assert.ok(p.yearly / 12 < p.monthly, `${id}: yearly is not cheaper per month`);
  assert.equal(p.yearly, p.monthly * 10, `${id}: yearly should equal 10 monthly ("2 months free")`);
}
t('yearly pricing matches the "two months free" claim');

const fakeEnv = {
  STRIPE_PRICE_PLUS_MONTH: 'price_pm', STRIPE_PRICE_PLUS_YEAR: 'price_py',
  STRIPE_PRICE_PRO_MONTH: 'price_rm', STRIPE_PRICE_PRO_YEAR: 'price_ry',
};
assert.equal(priceIdFor(fakeEnv, 'plus', 'month'), 'price_pm');
assert.equal(priceIdFor(fakeEnv, 'pro', 'year'), 'price_ry');
assert.deepEqual(planFromPriceId(fakeEnv, 'price_ry'), { plan: 'pro', interval: 'year' });
assert.equal(planFromPriceId(fakeEnv, 'price_unknown'), null);
t('price id ↔ plan mapping round-trips');

assert.match(currentPeriod(new Date('2026-08-09T00:00:00Z')), /^2026-08$/);
assert.equal(currentPeriod(new Date('2026-01-31T23:59:59Z')), '2026-01');
t('usage period is a UTC calendar month');

console.log('\nstripe webhook signature');
const secret = 'whsec_test';
const payload = JSON.stringify({ id: 'evt_1', type: 'customer.subscription.updated', data: { object: {} } });
const sign = (p, ts, sec = secret) =>
  `t=${ts},v1=${createHmac('sha256', sec).update(`${ts}.${p}`).digest('hex')}`;

const nowSec = Math.floor(Date.now() / 1000);
const event = await Stripe.verifyWebhook({ payload, signatureHeader: sign(payload, nowSec), secret });
assert.equal(event.id, 'evt_1');
t('a correctly signed payload is accepted');

await assert.rejects(
  () => Stripe.verifyWebhook({ payload, signatureHeader: sign(payload, nowSec, 'whsec_wrong'), secret }),
  /не съвпада/,
);
t('a payload signed with the wrong secret is rejected');

await assert.rejects(
  () => Stripe.verifyWebhook({ payload: payload.replace('evt_1', 'evt_2'), signatureHeader: sign(payload, nowSec), secret }),
  /не съвпада/,
);
t('tampering with the body invalidates the signature');

await assert.rejects(
  () => Stripe.verifyWebhook({ payload, signatureHeader: sign(payload, nowSec - 4000), secret }),
  /твърде стар/,
);
t('a replayed old signature is rejected');

await assert.rejects(
  () => Stripe.verifyWebhook({ payload, signatureHeader: null, secret }),
  /Липсва Stripe-Signature/,
);
await assert.rejects(
  () => Stripe.verifyWebhook({ payload, signatureHeader: 'garbage', secret }),
  /неочакван вид/,
);
t('missing and malformed signature headers are rejected');

// Stripe sends several v1 signatures during a secret rotation; any valid one counts.
const multi = `${sign(payload, nowSec, 'whsec_old')},v1=${createHmac('sha256', secret).update(`${nowSec}.${payload}`).digest('hex')}`;
const rotated = await Stripe.verifyWebhook({ payload, signatureHeader: multi, secret });
assert.equal(rotated.id, 'evt_1');
t('accepts one valid signature among several (secret rotation)');

console.log('\n' + pass + ' checks passed');
