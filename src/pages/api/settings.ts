import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { getSettings, saveProfile, saveSettings } from '~/lib/db';
import { initialsOf } from '~/lib/auth';
import { USE_CASES } from '~/lib/prompts';
import { modelChoices } from '~/lib/ai/choices';

export const prerender = false;

const ALLOWED_LANGUAGES = ['bg', 'en', 'de', 'ru'];

/** Моделите на тази инсталация — единственото, което може да се запише. */
function allowedModels(): string[] {
  return modelChoices({ chatModel: env.CHAT_MODEL, chatModelPro: env.CHAT_MODEL_PRO }).map(
    (m) => m.value,
  );
}

export const GET: APIRoute = handler(async (ctx) => {
  const settings = await getSettings(env.DB, ctx.locals.user.id);
  return json({
    settings,
    user: ctx.locals.user,
    /** Дали сървърът има свой ключ — от това зависи нужен ли е ключ от браузъра. */
    hasServerKey: Boolean(env.GEMINI_API_KEY),
    ragBackend: env.RAG_BACKEND === 'gemini' ? 'gemini' : 'vectorize',
    models: modelChoices({ chatModel: env.CHAT_MODEL, chatModelPro: env.CHAT_MODEL_PRO }),
  });
});

/** Празното е валидно: значи „питай ме пак“. */
const ALLOWED_USE_CASES = ['', ...USE_CASES.map((u) => u.value)] as string[];

export const PATCH: APIRoute = handler(async (ctx) => {
  const body = await readJson<{
    responseLanguage?: string;
    offlineMode?: boolean;
    chatModel?: string;
    displayName?: string;
    useCase?: string;
  }>(ctx.request);

  const patch: Parameters<typeof saveSettings>[2] = {};
  if (body.responseLanguage && ALLOWED_LANGUAGES.includes(body.responseLanguage)) {
    patch.responseLanguage = body.responseLanguage;
  }
  if (typeof body.offlineMode === 'boolean') patch.offlineMode = body.offlineMode;
  if (body.chatModel && allowedModels().includes(body.chatModel)) patch.chatModel = body.chatModel;
  // Само от познатите: стойността избира кои подсказки се пускат, тоест
  // произволен низ значи неутралния набор без някой да разбере защо.
  if (body.useCase !== undefined && ALLOWED_USE_CASES.includes(body.useCase)) {
    patch.useCase = body.useCase;
  }
  await saveSettings(env.DB, ctx.locals.user.id, patch);

  let user = ctx.locals.user;
  const name = body.displayName?.trim();
  if (name) {
    const clean = name.slice(0, 60);
    await saveProfile(env.DB, user.id, clean, initialsOf(clean));
    user = { ...user, displayName: clean, initials: initialsOf(clean) };
  }

  const settings = await getSettings(env.DB, user.id);
  return json({ settings, user });
});
