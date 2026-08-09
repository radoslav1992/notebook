import assert from 'node:assert/strict';

const {
  mailer, parseAddress, bareAddress, contactEmail, verifyEmail,
  DEFAULT_FROM, DEFAULT_CONTACT_EMAIL, DEFAULT_CONTACT_TO,
} = await import('../src/lib/email.ts');

let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name); };
const at = async (name, fn) => { await fn(); pass++; console.log('  ok  ' + name); };

/** Binding, който записва какво е получил. */
function stubBinding(fail) {
  const sent = [];
  return {
    sent,
    send(builder) {
      sent.push(builder);
      return fail ? Promise.reject(new Error('binding отказа')) : Promise.resolve({ ok: true });
    },
  };
}

console.log('addresses');

t('a display name becomes {name, email}, a bare address stays a string', () => {
  // Cloudflare приема или чист адрес, или обект. Подаден като цял низ,
  // „Записки <noreply@…>“ тръгва като адрес и писмото не излиза.
  assert.deepEqual(parseAddress('Записки <noreply@zapiski.bg>'), {
    name: 'Записки',
    email: 'noreply@zapiski.bg',
  });
  assert.equal(parseAddress('noreply@zapiski.bg'), 'noreply@zapiski.bg');
  assert.equal(parseAddress('  noreply@zapiski.bg  '), 'noreply@zapiski.bg');
});

t('quotes around the name are dropped, and a nameless bracket form collapses', () => {
  assert.deepEqual(parseAddress('"Записки" <a@b.bg>'), { name: 'Записки', email: 'a@b.bg' });
  assert.equal(parseAddress('<a@b.bg>'), 'a@b.bg');
});

t('bareAddress is what the page shows and what mailto: uses', () => {
  assert.equal(bareAddress('Записки <noreply@zapiski.bg>'), 'noreply@zapiski.bg');
  assert.equal(bareAddress('info@zapiski.bg'), 'info@zapiski.bg');
});

t('the built-in addresses are the ones the project actually uses', () => {
  assert.equal(bareAddress(DEFAULT_FROM), 'noreply@zapiski.bg');
  assert.equal(DEFAULT_CONTACT_EMAIL, 'info@zapiski.bg');
  assert.equal(DEFAULT_CONTACT_TO, 'dev.radoslav.dodnikov@gmail.com');
});

console.log('\nprovider choice');

t('the binding wins over a Resend key, and no provider is not an error', () => {
  assert.equal(mailer({ EMAIL: stubBinding() }).provider, 'cloudflare');
  // И двете налични: няма смисъл да се плаща на Resend, щом binding-ът го има.
  assert.equal(mailer({ EMAIL: stubBinding(), RESEND_API_KEY: 'k' }).provider, 'cloudflare');
  assert.equal(mailer({ RESEND_API_KEY: 'k' }).provider, 'resend');

  const none = mailer({});
  assert.equal(none.provider, 'none');
  assert.equal(none.enabled, false);
});

await at('the log-only mailer resolves instead of throwing', async () => {
  // Локално няма доставчик; регистрацията не бива да пада заради това —
  // връзката се показва в интерфейса.
  await mailer({}).send({ to: 'a@b.bg', subject: 'x', html: '<p>x</p>', text: 'x' });
});

console.log('\nsending through the binding');

await at('from carries the display name, and Reply-To is passed through', async () => {
  const EMAIL = stubBinding();
  await mailer({ EMAIL }).send({
    to: 'kum@example.com',
    subject: 'Тема',
    html: '<p>Тяло</p>',
    text: 'Тяло',
    replyTo: 'pishesh@example.com',
  });

  const [builder] = EMAIL.sent;
  assert.deepEqual(builder.from, { name: 'Записки', email: 'noreply@zapiski.bg' });
  assert.equal(builder.to, 'kum@example.com');
  assert.equal(builder.replyTo, 'pishesh@example.com');
  assert.equal(builder.subject, 'Тема');
  assert.equal(builder.html, '<p>Тяло</p>');
  assert.equal(builder.text, 'Тяло');
});

await at('without a Reply-To the field is left out, not sent empty', async () => {
  const EMAIL = stubBinding();
  await mailer({ EMAIL }).send({ to: 'a@b.bg', subject: 'x', html: '<p>x</p>', text: 'x' });
  assert.ok(!('replyTo' in EMAIL.sent[0]), JSON.stringify(EMAIL.sent[0]));
});

await at('EMAIL_FROM overrides the default sender', async () => {
  const EMAIL = stubBinding();
  await mailer({ EMAIL, EMAIL_FROM: 'Тест <hi@example.bg>' }).send({
    to: 'a@b.bg', subject: 'x', html: '<p>x</p>', text: 'x',
  });
  assert.deepEqual(EMAIL.sent[0].from, { name: 'Тест', email: 'hi@example.bg' });
});

await at('a failing binding surfaces as a rejection, not a silent success', async () => {
  await assert.rejects(
    () => mailer({ EMAIL: stubBinding(true) }).send({ to: 'a@b.bg', subject: 'x', html: '', text: '' }),
    /binding отказа/,
  );
});

console.log('\ncontact message');

t('the visitor goes in Reply-To, never in From', () => {
  const letter = contactEmail({
    name: 'Радослав',
    email: 'radoslav@example.com',
    message: 'Здравейте, имам въпрос.',
  });
  // Чужд адрес в From не минава проверките на домейна; Reply-To го прави
  // отговорим с едно натискане.
  assert.equal(letter.replyTo, 'radoslav@example.com');
  assert.match(letter.subject, /Радослав/);
  assert.ok(letter.text.includes('radoslav@example.com'));
  assert.ok(letter.text.includes('Здравейте, имам въпрос.'));
});

t('the message is escaped: it comes from a stranger and lands in HTML', () => {
  const letter = contactEmail({
    name: '<script>alert(1)</script>',
    email: 'a@b.bg',
    message: 'Виж това: <img src=x onerror=alert(1)> & после "край".',
  });
  assert.ok(!letter.html.includes('<script'), letter.html);
  assert.ok(!letter.html.includes('<img'), letter.html);
  assert.ok(letter.html.includes('&lt;script'), letter.html);
  assert.ok(letter.html.includes('&amp;'), letter.html);
});

t('a nameless sender still produces a usable subject', () => {
  const letter = contactEmail({ name: '', email: 'a@b.bg', message: 'нещо' });
  assert.match(letter.subject, /a@b\.bg/);
  assert.ok(letter.text.includes('(без име)'));
});

t('a signed-in sender carries their profile id', () => {
  const letter = contactEmail({ name: 'Х', email: 'a@b.bg', message: 'нещо', userId: 'u_42' });
  assert.ok(letter.text.includes('u_42'));
  assert.ok(letter.html.includes('u_42'));
  // Без профил редът просто не се появява.
  assert.ok(!contactEmail({ name: 'Х', email: 'a@b.bg', message: 'н' }).html.includes('Профил'));
});

t('the verification letter still renders with its link in both parts', () => {
  const letter = verifyEmail('https://zapiski.bg/verify?token=abc');
  assert.ok(letter.text.includes('https://zapiski.bg/verify?token=abc'));
  assert.ok(letter.html.includes('https://zapiski.bg/verify?token=abc'));
});

console.log('\n' + pass + ' checks passed');
