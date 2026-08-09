/// <reference types="astro/client" />
/// <reference types="@cloudflare/workers-types" />

/**
 * Bindings и променливи, които worker-ът получава.
 *
 * Написано на ръка, вместо `wrangler types`, по две причини: тайните не се
 * появяват в генерирания файл, а `vars` там се стесняват до литерали, което
 * прави сравненията от вида `RAG_BACKEND === 'gemini'` невъзможни.
 * Ако добавиш binding в wrangler.jsonc, добави го и тук.
 */
interface ZapiskiEnv {
  /** D1: тетрадки, източници, пасажи, съобщения, бележки, задачи. */
  DB: D1Database;
  /** R2: оригиналните файлове и генерираните аудио файлове. */
  FILES: R2Bucket;
  /** Vectorize: вгражданията на пасажите (1536 измерения, cosine). */
  VECTORIZE: VectorizeIndex;
  /** Статичните файлове; сервират се от Cloudflare, не от worker-а. */
  ASSETS?: Fetcher;

  /* ── Тайни (wrangler secret put …) ──────────────────────────────────── */
  GEMINI_API_KEY?: string;
  SESSION_SECRET?: string;

  /** Влизане с Google — Google Cloud → OAuth 2.0 Client ID (Web). */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  /** Писма за потвърждаване на имейл и нова парола (Resend). */
  RESEND_API_KEY?: string;

  /** Абонаменти (Stripe). */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_PLUS_MONTH?: string;
  STRIPE_PRICE_PLUS_YEAR?: string;
  STRIPE_PRICE_PRO_MONTH?: string;
  STRIPE_PRICE_PRO_YEAR?: string;
  /** Дни безплатен пробен период; без стойност — без пробен период. */
  STRIPE_TRIAL_DAYS?: string;

  /* ── Променливи (vars в wrangler.jsonc) ─────────────────────────────── */
  RAG_BACKEND?: 'vectorize' | 'gemini';
  CHAT_MODEL?: string;
  EMBED_MODEL?: string;
  TTS_MODEL?: string;
  RESPONSE_LANGUAGE?: string;
  /** Адресът, на който приложението живее — за връзките в писмата и OAuth. */
  PUBLIC_SITE_URL?: string;
  /** Подател на писмата, напр. „Записки <zdravey@tvoydomain.bg>“. */
  EMAIL_FROM?: string;

  /* ── Само за тестове: пренасочват външните API-та към макет ──────────── */
  GEMINI_BASE_URL?: string;
  STRIPE_BASE_URL?: string;
}

/** Типът, който `import { env } from 'cloudflare:workers'` връща. */
declare namespace Cloudflare {
  interface Env extends ZapiskiEnv {}
}

interface Env extends ZapiskiEnv {}

declare namespace App {
  interface Locals extends Record<string, unknown> {
    /** ExecutionContext на заявката — оттук идва `waitUntil`. */
    cfContext: ExecutionContext;
    /**
     * Попълва се от `src/middleware.ts` за пътищата, които искат сесия.
     * Inline `import(...)`, защото този файл е глобална декларация — истински
     * `import` отгоре би го превърнал в модул и `App`/`Env` биха изчезнали.
     */
    user: import('./lib/types').User;
    /** Ключ, подаден от браузъра (BYOK) — има приоритет над сървърния. */
    userGeminiKey?: string;
  }
}
