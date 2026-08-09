import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { resolveSession } from './lib/auth';

/**
 * Разрешава сесията само за пътищата, които наистина ѝ трябват.
 * Лендингът е публичен и не създава потребител — иначе всяко минаване
 * на робот щеше да оставя ред в базата.
 */
const NEEDS_SESSION = /^\/(app|api)(\/|$)/;

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (!NEEDS_SESSION.test(pathname)) {
    return next();
  }

  if (!env?.DB) {
    return new Response(
      'Липсва връзка към D1. Пусни приложението през `npm run dev` или `wrangler dev` с настроени bindings.',
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const secret = env.SESSION_SECRET;
  if (!secret) {
    return new Response(
      'Липсва SESSION_SECRET. Задай го в .dev.vars за локална работа или с `wrangler secret put SESSION_SECRET`.',
      { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const { user, setCookie } = await resolveSession(context.request, env.DB, secret);
  context.locals.user = user;

  // Собствен ключ от браузъра („Съхранява се локално на устройството ти“).
  const byok = context.request.headers.get('x-gemini-key');
  if (byok && /^AIza[\w-]{20,}$/.test(byok)) {
    context.locals.userGeminiKey = byok;
  }

  const response = await next();
  if (setCookie) {
    response.headers.append('set-cookie', setCookie);
  }
  return response;
});
