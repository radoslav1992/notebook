/**
 * Моделите по подразбиране — на едно място.
 *
 * Стояха разпръснати на четири (`gemini.ts`, `api.ts`, `choices.ts`,
 * `wrangler.jsonc`), тоест изтеглен от употреба модел трябваше да се сменя на
 * четири места, а пропуснатото се вижда само след deploy.
 *
 * Google изтегля модели по-рано от обявената дата за спиране: `gemini-2.5-flash`
 * и `gemini-2.5-pro` вече връщат „no longer available to new users“ на нови
 * ключове, макар да са обявени за спиране на 16 октомври 2026. Тоест стойностите
 * тук остаряват. Кои точно работят с ключа на тази инсталация се вижда на
 * `GET /api/models`.
 */

/** Текущият бърз модел. `gemini-2.5-flash` вече не важи за нови ключове. */
export const FALLBACK_CHAT_MODEL = 'gemini-3.6-flash';

/**
 * Многоезичен, 1536 измерения след съкращаване. Работи и с нови ключове.
 * `gemini-embedding-2` е по-новият, но е с друга ширина — смяната иска нов
 * Vectorize индекс, виж docs/models.md.
 */
export const FALLBACK_EMBED_MODEL = 'gemini-embedding-001';

/** Multi-speaker TTS с български. `gemini-2.5-flash-preview-tts` е preview от 2.5. */
export const FALLBACK_TTS_MODEL = 'gemini-3.1-flash-tts';
