import type { APIRoute } from 'astro';
import { ai, env, handler, json } from '~/lib/api';
import { providerFor } from '~/lib/ai';

export const prerender = false;

/**
 * Кои модели приема ключът на тази инсталация — и кои са зададени в момента.
 *
 * Съществува, защото „кой модел да сложа“ няма отговор наизуст: Google изтегля
 * модели по-рано от обявената дата за спиране и различни ключове виждат различни
 * списъци. Вместо да се гадае по документация, отваряш това и виждаш истината за
 * своя ключ.
 *
 * Иска профил: пътят е в `REQUIRES_AUTH` в middleware-а, защото всяко отваряне
 * праща заявка към Google — отворен, това е безплатен начин някой да хаби
 * квотата. Админ права не иска: списъкът не е тайна и всеки, който може да си
 * сложи свой ключ в Настройки, и без това го вижда.
 */
export const GET: APIRoute = handler(async (ctx) => {
  const bundle = ai(ctx);

  /**
   * Какво ползва приложението точно сега.
   *
   * Излиза ПРЕДИ да се пита Google, и без него. Иначе точно инсталацията, минала
   * на Cloudflare, не може да провери на какво работи: няма ключ → заявката
   * гърми → не се вижда нито един от трите модела. А това е единственото място,
   * което ги казва.
   */
  const configured = {
    chat: bundle.chat.model,
    embed: bundle.embed.model,
    embedDimensions: bundle.embed.dimensions,
    tts: bundle.tts.model,
    /** Кой доставчик поема всяка роля — това решава името на модела. */
    provider: {
      chat: providerFor(bundle.chat.model),
      embed: providerFor(bundle.embed.model),
      tts: providerFor(bundle.tts.model),
    },
    /** Има ли ключ за Google: без него YouTube, аудио и File Search отказват. */
    googleKey: Boolean(bundle.google),
    // Стойностите както са зададени. Показват се, за да се вижда кога работи
    // резервната от кода, вместо зададената — празно тук значи точно това.
    chatVar: env.CHAT_MODEL ?? null,
    chatProVar: env.CHAT_MODEL_PRO ?? null,
    embedVar: env.EMBED_MODEL ?? null,
    ttsVar: env.TTS_MODEL ?? null,
  };

  // Списъкът с моделите е на Google и иска ключ. Липсва ли — казваме го, но
  // горното си остава.
  if (!bundle.google) {
    return json({
      configured,
      usable: null,
      note: 'Списъкът с моделите на Google иска GEMINI_API_KEY. Зададените по-горе модели работят и без него, ако името им сочи Cloudflare.',
    });
  }

  const all = await bundle.google.listModels();
  const has = (m: { methods: string[] }, method: string) => m.methods.includes(method);
  const shape = (m: (typeof all)[number]) => ({ id: m.id, name: m.displayName });

  return json({
    configured,
    usable: {
      /** Годни за CHAT_MODEL и CHAT_MODEL_PRO. */
      chat: all.filter((m) => has(m, 'generateContent')).map(shape),
      /** Годни за EMBED_MODEL. Ширината се задава с EMBED_DIMENSIONS. */
      embed: all
        .filter((m) => has(m, 'embedContent') || has(m, 'batchEmbedContents'))
        .map(shape),
      /**
       * Годни за TTS_MODEL. Google не маркира TTS с отделен метод, затова се
       * търси по име — по-добре малко излишни, отколкото празен списък.
       */
      tts: all.filter((m) => /tts|speech/i.test(m.id)).map(shape),
    },
    total: all.length,
  });
});
