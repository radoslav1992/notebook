import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { peekSession, resolveSession } from './lib/auth';
import type { User } from './lib/types';

/**
 * Пътища, на които трябва да има ред в базата: тук се създава съдържание, а то
 * трябва да е собственост на някого. Тези пътища правят анонимен профил, ако
 * няма сесия — така приложението се пробва без регистрация.
 */
const CREATES_GUEST = /^\/(app(\/|$)|api\/(notebooks|settings|me)(\/|$))/;

/**
 * Пътища, които само гледат кой е влязъл: вход, регистрация, плащане.
 * Тук нарочно НЕ се създава профил — иначе всяко зареждане на /login и всеки
 * опит за вход щеше да оставя празен ред в базата.
 */
const PEEKS_ONLY = /^\/(login|register|forgot|reset|verify|api\/(auth|billing)(\/|$))/;

/**
 * Stripe идва без бисквитка и се проверява с подпис.
 * Ако минеше през сесията, всяко събитие щеше да прави нов профил.
 */
const NO_SESSION = /^\/api\/billing\/webhook$/;

/** Как изглежда „никой не е влязъл“, без да пишем в базата. */
const NOBODY: User = {
  id: '',
  displayName: 'Гост',
  initials: 'ГО',
  email: null,
  emailVerified: false,
  isAnonymous: true,
  hasPassword: false,
  hasGoogle: false,
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  const creates = CREATES_GUEST.test(pathname);
  const peeks = !creates && PEEKS_ONLY.test(pathname);

  if (NO_SESSION.test(pathname) || (!creates && !peeks)) {
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

  let setCookie: string | undefined;

  if (peeks) {
    context.locals.user = (await peekSession(context.request, env.DB, secret)) ?? NOBODY;
  } else {
    const resolved = await resolveSession(context.request, env.DB, secret);
    context.locals.user = resolved.user;
    setCookie = resolved.setCookie;
  }

  // Собствен ключ от браузъра („Съхранява се локално на устройството ти“).
  const byok = context.request.headers.get('x-gemini-key');
  if (byok && /^AIza[\w-]{20,}$/.test(byok)) {
    context.locals.userGeminiKey = byok;
  }

  const response = await next();

  // Ако маршрутът вече е издал сесия (вход, регистрация, нова парола), неговата
  // бисквитка печели — нашата би я презаписала, защото се добавя след нея.
  if (setCookie && !setsSessionCookie(response)) {
    response.headers.append('set-cookie', setCookie);
  }
  return response;
});

function setsSessionCookie(response: Response): boolean {
  const all =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : [response.headers.get('set-cookie') ?? ''];
  return all.some((value) => value.startsWith('zapiski_sid='));
}
