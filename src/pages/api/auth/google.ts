import type { APIRoute } from 'astro';
import { env, handler } from '~/lib/api';
import { safeNext, siteUrl, stateCookie } from '~/lib/authApi';
import { googleAuthUrl } from '~/lib/oauth';
import { HttpError } from '~/lib/db';

export const prerender = false;

/**
 * Праща към Google.
 *
 * `state` носи две неща: случаен низ, който трябва да съвпадне с бисквитка
 * (срещу CSRF), и къде да върнем човека след влизане.
 */
export const GET: APIRoute = handler(async (ctx) => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new HttpError(503, 'Влизането с Google не е настроено на този сървър.');
  }

  const nonce = crypto.randomUUID();
  const next = safeNext(ctx.url.searchParams.get('next'));

  const url = googleAuthUrl({
    clientId: env.GOOGLE_CLIENT_ID,
    redirectUri: `${siteUrl(ctx.request)}/api/auth/google/callback`,
    state: `${nonce}:${encodeURIComponent(next)}`,
  });

  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      'set-cookie': stateCookie(ctx.url.protocol === 'https:', nonce),
      'cache-control': 'no-store',
    },
  });
});
