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
    // Изнася всичко, което човекът е писал. Ако падне в „peek“, файлът се
    // сваля с празна сесия, тоест от всеки.
    '/api/me/export',
    // Прави заявка към Google при всяко отваряне — отворен, той е безплатен
    // начин някой да хаби квотата на инсталацията.
    '/api/models',
    // Организациите и библиотеките: всяко от тези чете или пипа общи данни.
    '/api/orgs',
    '/api/orgs/org_1/invites',
    '/api/orgs/join',
    '/api/notebooks/nb_123/library',
    // Приемането на покана иска профил — поканата се връзва за имейла на влезлия.
    '/join',
    // Библиотеката се чете само от членове; проверката за роля е в страницата,
    // но без вход дори до нея не се стига.
    '/app/library/nb_1',
    '/api/orgs/org_1/members',
  ]) {
    assert.equal(classifyRoute(p), 'guarded', p);
  }
});

t('marketing pages stay open to everyone', () => {
  for (const p of [
    '/',
    '/pricing',
    // Политиката и условията трябва да се четат ПРЕДИ да има профил — точно
    // затова се сочат от долния колонтитул на началната страница.
    '/privacy',
    '/terms',
    '/favicon.ico',
    '/_astro/app.css',
    '/robots.txt',
  ]) {
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
    // Формата за контакт е отворена нарочно — човек без профил също пише — но
    // минава през „peek“, за да може имейлът на влязъл да се попълни сам.
    '/contact',
    '/api/contact',
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
