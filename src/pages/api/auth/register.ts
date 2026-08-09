import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import {
  createUser,
  findUserByEmail,
  hashPassword,
  nameFromEmail,
  normalizeEmail,
  startSession,
  upgradeAnonymous,
} from '~/lib/auth';
import {
  attemptKey,
  rateLimit,
  sendVerification,
  sessionSecret,
  validateCredentials,
} from '~/lib/authApi';
import { HttpError } from '~/lib/db';

export const prerender = false;

/**
 * Регистрация с имейл и парола.
 *
 * Ако човекът е ползвал приложението като гост, същият ред става истински
 * профил — тетрадките, направени преди регистрацията, остават негови, без да
 * се мести нищо.
 */
export const POST: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ email?: string; password?: string; name?: string }>(ctx.request);
  const email = normalizeEmail(body.email ?? '');
  const password = body.password ?? '';
  validateCredentials(email, password);

  await rateLimit(env.DB, attemptKey(ctx, email), { limit: 6 });

  const current = ctx.locals.user;
  if (!current.isAnonymous) {
    throw new HttpError(409, 'Вече си влязъл в профил. Излез и опитай пак.');
  }

  if (await findUserByEmail(env.DB, email)) {
    throw new HttpError(409, 'Вече има профил с този имейл. Влез вместо да се регистрираш.');
  }

  const displayName = (body.name ?? '').trim().slice(0, 60) || nameFromEmail(email);
  const passwordHash = await hashPassword(password);

  // Гост → същият ред става истински профил, за да си запази тетрадките.
  // Без сесия (примерно директна заявка към API-то) → нов профил.
  let userId: string;
  if (current.id) {
    userId = current.id;
    await upgradeAnonymous(env.DB, userId, {
      email,
      displayName,
      passwordHash,
      emailVerified: false,
    });
  } else {
    const created = await createUser(env.DB, {
      email,
      displayName,
      passwordHash,
      emailVerified: false,
    });
    userId = created.id;
  }

  const kept = await env.DB.prepare('SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ?')
    .bind(userId)
    .first<{ c: number }>();

  const { cookie } = await startSession(ctx.request, env.DB, sessionSecret(), userId);
  const { sent, link } = await sendVerification(ctx.request, env.DB, userId, email);

  return json(
    {
      ok: true,
      emailSent: sent,
      // Без настроен доставчик връзката се връща, за да работи локално.
      verifyLink: sent ? undefined : link,
      keptNotebooks: kept?.c ?? 0,
    },
    { status: 201, headers: { 'set-cookie': cookie } },
  );
});
