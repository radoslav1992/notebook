import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { HttpError } from '~/lib/db';
import { isValidEmail, normalizeEmail } from '~/lib/auth';
import { rateLimit } from '~/lib/authApi';
import { DEFAULT_CONTACT_TO, contactEmail, mailer } from '~/lib/email';

export const prerender = false;

const MAX_NAME = 80;
const MIN_MESSAGE = 15;
const MAX_MESSAGE = 4000;

/**
 * Формата за контакт. Отворена е нарочно — човек без профил също трябва да може
 * да пише — затова е и единственият път, по който непознат предизвиква
 * изпращане на писмо. Пази се с брояч по адрес: 3 съобщения на 15 минути.
 *
 * Ако някой ден почне да идва спам, следващата стъпка е Cloudflare Turnstile
 * пред формата, не по-строг брояч.
 */
export const POST: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ name?: string; email?: string; message?: string }>(ctx.request);

  const name = (body.name ?? '').trim().slice(0, MAX_NAME);
  const email = normalizeEmail(body.email ?? '');
  const message = (body.message ?? '').trim();

  if (!isValidEmail(email)) {
    throw new HttpError(400, 'Остави имейл, на който да ти отговорим.');
  }
  if (message.length < MIN_MESSAGE) {
    throw new HttpError(400, 'Напиши малко повече, за да разберем за какво става дума.');
  }
  if (message.length > MAX_MESSAGE) {
    throw new HttpError(400, `Съобщението е над ${MAX_MESSAGE} знака. Съкрати го или го изпрати на части.`);
  }

  const ip = ctx.request.headers.get('cf-connecting-ip') ?? 'local';
  await rateLimit(env.DB, `contact_${ip}`.slice(0, 120), { limit: 3, windowMs: 15 * 60_000 });

  const post = mailer(env);
  if (!post.enabled) {
    // Без доставчик писмото само влиза в лога. По-добре е човекът да го научи,
    // отколкото да види „изпратено“ и да чака отговор, който няма да дойде.
    throw new HttpError(
      503,
      'Формата не е настроена докрай. Пиши директно на info@zapiski.bg.',
    );
  }

  const letter = contactEmail({
    name,
    email,
    message,
    // `locals.user` го има, защото пътят е в PEEKS_ONLY; празно значи „без профил“.
    userId: ctx.locals.user?.id || null,
  });

  await post.send({
    to: env.CONTACT_TO || DEFAULT_CONTACT_TO,
    subject: letter.subject,
    html: letter.html,
    text: letter.text,
    replyTo: letter.replyTo,
  });

  return json({ ok: true });
});
