/**
 * Кой доставчик обслужва даден модел — решава се от самото име на модела.
 *
 * Няма отделна променлива за доставчик и не трябва да има: идентификаторите не
 * се застъпват. Google API-то ползва имена без наклонена черта
 * (`gemini-2.5-flash`, `gemini-embedding-001`), а всичко в Cloudflare има черта
 * — собствените им модели са `@cf/...`, партньорските са `google/...`,
 * `xai/...` и така нататък. Тоест смяната на доставчик е смяна на един низ:
 *
 *   CHAT_MODEL: "gemini-2.5-flash"            → Google, с GEMINI_API_KEY
 *   CHAT_MODEL: "google/gemini-3.6-flash"     → Cloudflare, без ключ на Google
 *   CHAT_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" → Cloudflare
 */
export type Provider = 'google' | 'cloudflare';

export function providerFor(model: string): Provider {
  return model.includes('/') ? 'cloudflare' : 'google';
}

/**
 * Партньорските модели `google/*` в Cloudflare приемат тялото на Gemini
 * (`contents`, `generationConfig`, `speechConfig`), докато собствените `@cf/*`
 * имат своя форма (`messages`, `prompt`, `text`). Различието е само в тялото —
 * и двете минават през `env.AI.run`.
 */
export function usesGeminiShape(model: string): boolean {
  return model.startsWith('google/');
}

/**
 * Формата на тялото за даден модел през `env.AI.run`. Три са, не две:
 *
 *  • `gemini`    — `google/*`: `contents` / `generationConfig`
 *  • `responses` — `openai/*`: Responses API, `input` / `instructions` /
 *                  `max_output_tokens`, а отговорът идва в `output`
 *  • `messages`  — `@cf/*` и всичко останало: `messages` / `max_tokens`
 *
 * Разликата не е козметична: подадени грешни полета, моделът не гърми, а тихо
 * игнорира тавана и температурата.
 */
export type BodyShape = 'gemini' | 'responses' | 'messages';

export function bodyShapeFor(model: string): BodyShape {
  if (model.startsWith('google/')) return 'gemini';
  if (model.startsWith('openai/')) return 'responses';
  return 'messages';
}

/**
 * Ширината на вектора за даден модел за вграждане.
 *
 * Числото трябва да съвпада с Vectorize индекса, а ширината на съществуващ
 * индекс не се мени — смяната на модела изисква нов индекс и повторно
 * индексиране на всички източници. `EMBED_DIMENSIONS` в конфигурацията
 * замества таблицата, ако някой ден модел се появи тук с друга стойност.
 */
const DIMENSIONS: Record<string, number> = {
  // Google: `gemini-embedding-001` връща 3072, но е Matryoshka — иска се 1536
  // и се нормализира наново.
  'gemini-embedding-001': 1536,
  'text-embedding-004': 768,
  // Cloudflare: bge-m3 е единственият многоезичен, тоест единственият годен за
  // български. Останалите са само за английски.
  '@cf/baai/bge-m3': 1024,
  '@cf/baai/bge-large-en-v1.5': 1024,
  '@cf/baai/bge-base-en-v1.5': 768,
  '@cf/baai/bge-small-en-v1.5': 384,
  '@cf/google/embeddinggemma-300m': 768,
};

export const DEFAULT_EMBED_DIMENSIONS = 1536;

export function dimensionsFor(model: string, override?: string | number): number {
  const forced = Number(override);
  if (Number.isFinite(forced) && forced > 0) return Math.floor(forced);
  return DIMENSIONS[model] ?? DEFAULT_EMBED_DIMENSIONS;
}

/** Многоезичен ли е моделът за вграждане — единственият въпрос, който има значение за български. */
export function isMultilingualEmbed(model: string): boolean {
  if (providerFor(model) === 'google') return true;
  return model === '@cf/baai/bge-m3' || model === '@cf/google/embeddinggemma-300m';
}
