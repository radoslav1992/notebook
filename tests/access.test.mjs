import assert from 'node:assert/strict';

const { classifyRoute } = await import('../src/middleware.ts');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };

console.log('route access');

t('the app and everything it writes through needs an account', () => {
  for (const p of [
    '/app',
    '/app/',
    '/app/settings',
    '/app/notebook/nb_123',
    '/api/notebooks',
    '/api/notebooks/nb_123/sources',
    '/api/notebooks/nb_123/chat',
    '/api/settings',
    '/api/me',
  ]) {
    assert.equal(classifyRoute(p), 'guarded', p);
  }
});

t('marketing pages stay open to everyone', () => {
  for (const p of ['/', '/pricing', '/favicon.ico', '/_astro/app.css', '/robots.txt']) {
    assert.equal(classifyRoute(p), 'open', p);
  }
});

t('the auth and billing endpoints only peek, so they never demand a session', () => {
  for (const p of [
    '/login',
    '/register',
    '/forgot',
    '/reset',
    '/verify',
    '/api/auth/login',
    '/api/auth/google',
    '/api/auth/google/callback',
    '/api/billing/checkout',
  ]) {
    assert.equal(classifyRoute(p), 'peek', p);
  }
});

t('the Stripe webhook is open: it carries a signature, not a cookie', () => {
  // Ако попадне в „peek“, всяко събитие минава през сесията за нищо; ако
  // попадне в „guarded“, Stripe получава 401 и плащанията спират да се отчитат.
  assert.equal(classifyRoute('/api/billing/webhook'), 'open');
});

t('a path that merely starts with a guarded name is not guarded', () => {
  // /application и /apple не са /app — иначе бъдещи страници мълчаливо
  // изчезват зад входа.
  assert.equal(classifyRoute('/application'), 'open');
  assert.equal(classifyRoute('/apple'), 'open');
  assert.equal(classifyRoute('/api/notebooksomething'), 'open');
});

t('no route is both guarded and peek', () => {
  for (const p of ['/app', '/login', '/api/me', '/api/auth/login', '/api/billing/webhook']) {
    const kind = classifyRoute(p);
    assert.ok(['guarded', 'peek', 'open'].includes(kind), p);
  }
});

console.log('\n' + pass + ' checks passed');
