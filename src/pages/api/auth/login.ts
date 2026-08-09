import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import {
  claimAnonymous,
  findUserByEmail,
  getPasswordHash,
  normalizeEmail,
  startSession,
  verifyPassword,
  wastePasswordTime,
} from '~/lib/auth';
import { attemptKey, rateLimit, sessionSecret } from '~/lib/authApi';
import { HttpError } from '~/lib/db';

export const prerender = false;

export const POST: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ email?: string; password?: string }>(ctx.request);
  const email = normalizeEmail(body.email ?? '');
  const password = body.password ?? '';
  if (!email || !password) throw new HttpError(400, 'Въведи имейл и парола.');

  await rateLimit(env.DB, attemptKey(ctx, email));

  const user = await findUserByEmail(env.DB, email);
  const hash = user ? await getPasswordHash(env.DB, user.id) : null;

  // Едно и също съобщение при непознат имейл и при грешна парола: иначе
  // формата казва кои адреси имат профил.
  const wrong = new HttpError(401, 'Имейлът или паролата не съвпадат.');
  if (!user || !hash) {
    // Изразходваме сравнимо време, за да не се различават двата случая.
    await wastePasswordTime(password);
    throw wrong;
  }
  if (!(await verifyPassword(password, hash))) throw wrong;

  // Тетрадките, направени като гост, минават към профила.
  const guest = ctx.locals.user;
  const claimed =
    guest.id && guest.isAnonymous ? await claimAnonymous(env.DB, guest.id, user.id) : 0;

  const { cookie } = await startSession(ctx.request, env.DB, sessionSecret(), user.id);
  return json(
    { ok: true, claimedNotebooks: claimed, emailVerified: user.emailVerified },
    { headers: { 'set-cookie': cookie } },
  );
});
