import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { findUserByEmail, normalizeEmail } from '~/lib/auth';
import { attemptKey, rateLimit, sendReset } from '~/lib/authApi';
import { HttpError } from '~/lib/db';

export const prerender = false;

/**
 * Заявка за нова парола.
 *
 * Отговорът е един и същ, независимо дали профилът съществува — иначе формата
 * се превръща в начин да се проверява кои имейли са регистрирани.
 */
export const POST: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ email?: string }>(ctx.request);
  const email = normalizeEmail(body.email ?? '');
  if (!email) throw new HttpError(400, 'Въведи имейл.');

  await rateLimit(env.DB, attemptKey(ctx, email), { limit: 5 });

  const user = await findUserByEmail(env.DB, email);
  let link: string | undefined;

  if (user) {
    const res = await sendReset(ctx.request, env.DB, user.id, email);
    if (!res.sent) link = res.link;
  }

  return json({
    ok: true,
    message: 'Ако има профил с този адрес, писмото е на път.',
    // Само когато няма настроен доставчик — за локална работа.
    resetLink: link,
  });
});
