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

  /* ── Променливи (vars в wrangler.jsonc) ─────────────────────────────── */
  RAG_BACKEND?: 'vectorize' | 'gemini';
  CHAT_MODEL?: string;
  EMBED_MODEL?: string;
  TTS_MODEL?: string;
  RESPONSE_LANGUAGE?: string;
  /** Различен адрес на Gemini API — за прокси или локални тестове. */
  GEMINI_BASE_URL?: string;
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
    /** Попълва се от `src/middleware.ts` за всички /app и /api пътища. */
    user: { id: string; displayName: string; initials: string };
    /** Ключ, подаден от браузъра (BYOK) — има приоритет над сървърния. */
    userGeminiKey?: string;
  }
}
