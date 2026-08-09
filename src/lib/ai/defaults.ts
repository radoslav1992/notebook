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

/**
 * Multi-speaker TTS.
 *
 * Внимавай със суфикса: моделът се води „Gemini 3.1 Flash TTS“, но в API-то е
 * `gemini-3.1-flash-tts-preview`. Без `-preview` отговорът е „is not found for
 * API version v1beta“.
 *
 * `gemini-2.5-flash-preview-tts` стоеше тук и вече го няма — цялото 2.5
 * семейство отпадна, не само `gemini-2.5-flash` и `gemini-2.5-pro`. Тоест и
 * тази стойност ще остарее: `GET /api/models` (`usable.tts`) казва кое работи с
 * ключа, а при несъществуващ модел самата грешка изброява приетите.
 */
export const FALLBACK_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
