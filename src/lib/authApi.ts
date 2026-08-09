import { env } from 'cloudflare:workers';
import type { APIContext } from 'astro';
import { HttpError } from './db';
import {
  createEmailToken,
  isValidEmail,
  normalizeEmail,
  passwordProblem,
} from './auth';
import { mailer, resetEmail, verifyEmail } from './email';

/** Тайната за подписи; без нея нищо в аутентикацията не е безопасно. */
export function sessionSecret(): string {
  const secret = env.SESSION_SECRET;
  if (!secret) throw new HttpError(500, 'Липсва SESSION_SECRET на сървъра.');
  return secret;
}

/** Базовият адрес на приложението — за връзките в писмата и за OAuth redirect. */
export function siteUrl(request: Request): string {
  if (env.PUBLIC_SITE_URL) return env.PUBLIC_SITE_URL.replace(/\/+$/, '');
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function validateCredentials(email: string, password: string): void {
  if (!isValidEmail(email)) throw new HttpError(400, 'Имейлът не изглежда валиден.');
  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);
}

/* ── Писма ───────────────────────────────────────────────────────────────── */

export async function sendVerification(
  request: Request,
  db: D1Database,
  userId: string,
  email: string,
): Promise<{ sent: boolean; link: string }> {
  const token = await createEmailToken(db, userId, 'verify', email);
  const link = `${siteUrl(request)}/verify?token=${encodeURIComponent(token)}`;
  const post = mailer(env);
  const body = verifyEmail(link);
  await post.send({ to: normalizeEmail(email), ...body });
  return { sent: post.enabled, link };
}

export async function sendReset(
  request: Request,
  db: D1Database,
  userId: string,
  email: string,
): Promise<{ sent: boolean; link: string }> {
  const token = await createEmailToken(db, userId, 'reset', email);
  const link = `${siteUrl(request)}/reset?token=${encodeURIComponent(token)}`;
  const post = mailer(env);
  const body = resetEmail(link);
  await post.send({ to: normalizeEmail(email), ...body });
  return { sent: post.enabled, link };
}

/* ── Google OAuth ────────────────────────────────────────────────────────── */

export const OAUTH_STATE_COOKIE = 'zapiski_oauth';

/** Пътят за връщане трябва да е вътрешен — иначе става отворено пренасочване. */
export function safeNext(value: string | null | undefined): string {
  if (!value) return '/app';
  if (!value.startsWith('/') || value.startsWith('//')) return '/app';
  return value.slice(0, 200);
}

export function stateCookie(secure: boolean, nonce: string, maxAge = 600): string {
  return [
    `${OAUTH_STATE_COOKIE}=${nonce}`,
    'Path=/api/auth/google',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ].join('; ');
}

/* ── Ограничаване на опитите ─────────────────────────────────────────────── */

/**
 * Прост брояч срещу налучкване на пароли: плъзгащ прозорец в D1.
 * Достатъчно е за приложение с този размер и не иска нов ресурс; ако трафикът
 * порасне, това е първото, което да мине в KV или Durable Object.
 */
export async function rateLimit(
  db: D1Database,
  key: string,
  { limit = 8, windowMs = 15 * 60_000 } = {},
): Promise<void> {
  const windowStart = Math.floor(Date.now() / windowMs) * windowMs;
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start
                      THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start
       RETURNING count`,
    )
    .bind(key, windowStart)
    .first<{ count: number }>();

  if ((row?.count ?? 0) > limit) {
    throw new HttpError(429, 'Твърде много опити. Опитай пак след няколко минути.');
  }
}

/** Ключ за ограничаване: имейл плюс адрес, за да не блокираме цяла мрежа. */
export function attemptKey(ctx: APIContext, email: string): string {
  const ip = ctx.request.headers.get('cf-connecting-ip') ?? 'local';
  return `rl_${normalizeEmail(email)}_${ip}`.slice(0, 120);
}
