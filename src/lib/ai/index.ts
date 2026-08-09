/**
 * Кой модел откъде идва — сглобява се тук, на едно място.
 *
 * Приложението нататък не знае кой е доставчикът: `ai.chat`, `ai.embed` и
 * `ai.tts` са три роли, а всяка може да е при Google или при Cloudflare
 * независимо от останалите. Изборът е името на модела (виж select.ts), тоест
 * преместването на подкаста към Cloudflare е смяна на един низ:
 *
 *   TTS_MODEL: "gemini-2.5-flash-preview-tts"   → Google
 *   TTS_MODEL: "google/gemini-3.1-flash-tts"    → Cloudflare
 */

import { Gemini } from '../gemini';
import { AiError } from './error';
import { CloudflareAi, type AiBinding } from './cloudflare';
import { googleChat, googleEmbed, googleTts } from './google';
import { dimensionsFor, providerFor } from './select';
import type { ChatModel, EmbedModel, SpeechModel } from './types';

export { AiError } from './error';
export type { AiBinding } from './cloudflare';
export * from './select';
export * from './choices';
export type * from './types';

export interface Ai {
  chat: ChatModel;
  embed: EmbedModel;
  tts: SpeechModel;
  /**
   * Клиентът на Google, когато има ключ. Нужен е за трите неща, които само той
   * може: YouTube по линк, вграден аудио файл и File Search. `null` значи, че
   * тези пътища трябва да откажат с ясно съобщение, а не да гръмнат.
   */
  google: Gemini | null;
}

export interface AiConfig {
  chatModel: string;
  embedModel: string;
  ttsModel: string;
  /** Замества таблицата с ширини — само ако модел се появи с друга стойност. */
  embedDimensions?: string | number;
  googleKey?: string;
  /** Друг адрес на Google API — за прокси или за тестове. */
  googleHost?: string;
  /** Workers AI binding-ът; липсва в тестове и при `astro dev` без Cloudflare. */
  ai?: AiBinding;
}

export function buildAi(cfg: AiConfig): Ai {
  const dimensions = dimensionsFor(cfg.embedModel, cfg.embedDimensions);

  const google = cfg.googleKey
    ? new Gemini({
        apiKey: cfg.googleKey,
        chatModel: cfg.chatModel,
        embedModel: cfg.embedModel,
        ttsModel: cfg.ttsModel,
        host: cfg.googleHost,
      })
    : null;

  /** Google е нужен, но ключ няма — казваме кое точно го иска. */
  const requireGoogle = (role: string, model: string): Gemini => {
    if (google) return google;
    throw new AiError(
      401,
      `Моделът ${model} за ${role} е при Google, но липсва GEMINI_API_KEY. Задай ключ или сложи модел на Cloudflare.`,
    );
  };

  const cloudflare = (model: string, role: string): CloudflareAi => {
    if (!cfg.ai) {
      throw new AiError(
        500,
        `Моделът ${model} за ${role} е при Cloudflare, но липсва Workers AI binding. Добави "ai": { "binding": "AI" } в wrangler.jsonc.`,
      );
    }
    return new CloudflareAi({ ai: cfg.ai, model, dimensions });
  };

  return {
    chat:
      providerFor(cfg.chatModel) === 'google'
        ? googleChat(requireGoogle('чата', cfg.chatModel))
        : cloudflare(cfg.chatModel, 'чата'),
    embed:
      providerFor(cfg.embedModel) === 'google'
        ? googleEmbed(requireGoogle('вгражданията', cfg.embedModel), dimensions)
        : cloudflare(cfg.embedModel, 'вгражданията'),
    tts:
      providerFor(cfg.ttsModel) === 'google'
        ? googleTts(requireGoogle('речта', cfg.ttsModel))
        : cloudflare(cfg.ttsModel, 'речта'),
    google,
  };
}

/**
 * Google-специфична възможност, поискана без ключ за Google.
 * Пътищата за YouTube, вграден звук и File Search минават през това.
 */
export function requireGoogleFeature(ai: Ai, what: string): Gemini {
  if (ai.google) return ai.google;
  throw new AiError(
    400,
    `${what} минава само през Google. Задай GEMINI_API_KEY или ползвай друг вид източник.`,
  );
}
