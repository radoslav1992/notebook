import type { APIRoute } from 'astro';
import { ai, env, handler, json } from '~/lib/api';
import { requireGoogleFeature } from '~/lib/ai';

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
  const google = requireGoogleFeature(bundle, 'Списъкът с моделите на Google');
  const all = await google.listModels();

  const has = (m: { methods: string[] }, method: string) => m.methods.includes(method);
  const shape = (m: (typeof all)[number]) => ({ id: m.id, name: m.displayName });

  return json({
    /** Какво ползва приложението точно сега — сравни с групите отдолу. */
    configured: {
      chat: bundle.chat.model,
      embed: bundle.embed.model,
      embedDimensions: bundle.embed.dimensions,
      tts: bundle.tts.model,
      // Тези две идват от vars в wrangler.jsonc. Стойност, въведена в
      // dashboard-а, се заменя при следващия deploy — затова се показват тук.
      chatVar: env.CHAT_MODEL ?? null,
      chatProVar: env.CHAT_MODEL_PRO ?? null,
    },
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
