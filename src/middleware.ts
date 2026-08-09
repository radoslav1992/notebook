import { env } from 'cloudflare:workers';
import { defineMiddleware } from 'astro:middleware';
import { peekSession } from './lib/auth';
import type { User } from './lib/types';

/**
 * Пътища, които искат истински профил: тук се създава съдържание и се харчи
 * Gemini квота, затова трябва да има кой да отговаря за тях. Без сесия
 * страниците пренасочват към входа, а API-тата отговарят с 401.
 */
const REQUIRES_AUTH = /^\/(app(\/|$)|api\/(notebooks|settings|me|models)(\/|$))/;

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

export type RouteKind =
  /** Иска истински профил. */
  | 'guarded'
  /** Гледа кой е влязъл, но не изисква профил. */
  | 'peek'
  /** Не пипа сесията: лендинг, цени, статични файлове, Stripe webhook. */
  | 'open';

/**
 * Кое правило важи за даден път. Отделено от middleware-а, защото тези три
 * израза са границата на достъпа — сгрешен израз или отваря /app за всички, или
 * заключва webhook-а на Stripe, а и двете мълчат, докато не стане късно.
 */
export function classifyRoute(pathname: string): RouteKind {
  if (NO_SESSION.test(pathname)) return 'open';
  if (REQUIRES_AUTH.test(pathname)) return 'guarded';
  if (PEEKS_ONLY.test(pathname)) return 'peek';
  return 'open';
}

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

  const kind = classifyRoute(pathname);
  if (kind === 'open') return next();
  const guarded = kind === 'guarded';

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

  const session = await peekSession(context.request, env.DB, secret);

  // Профилите на гости от по-ранна версия още имат валидни сесии. Те минават
  // през входа като всички останали, а тетрадките им се прибират при влизане
  // или при регистрация (`claimAnonymous` / `upgradeAnonymous`).
  if (guarded && (!session || session.isAnonymous)) {
    return refuse(context.url, pathname.startsWith('/api/'));
  }

  context.locals.user = session ?? NOBODY;

  // Собствен ключ от браузъра („Съхранява се локално на устройството ти“).
  const byok = context.request.headers.get('x-gemini-key');
  if (byok && /^AIza[\w-]{20,}$/.test(byok)) {
    context.locals.userGeminiKey = byok;
  }

  return next();
});

/**
 * Няма профил. Страниците отиват на входа и се връщат на същото място след
 * това; API-тата отговарят с 401 и с `signedOut`, по което браузърът различава
 * „изтекла сесия“ от другите 401-ици — отказан Gemini ключ например също е 401,
 * а той не трябва да изхвърля никого към входа.
 */
function refuse(url: URL, isApi: boolean): Response {
  if (isApi) {
    return new Response(
      JSON.stringify({ error: 'Влез в профила си, за да продължиш.', signedOut: true }),
      {
        status: 401,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      },
    );
  }
  const next = `${url.pathname}${url.search}`;
  return new Response(null, {
    status: 302,
    headers: {
      location: `/login?next=${encodeURIComponent(next)}`,
      'cache-control': 'no-store',
    },
  });
}
