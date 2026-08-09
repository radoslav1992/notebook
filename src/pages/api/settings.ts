import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { getSettings, saveProfile, saveSettings } from '~/lib/db';
import { initialsOf } from '~/lib/auth';

export const prerender = false;

const ALLOWED_MODELS = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite'];
const ALLOWED_LANGUAGES = ['bg', 'en', 'de', 'ru'];

export const GET: APIRoute = handler(async (ctx) => {
  const settings = await getSettings(env.DB, ctx.locals.user.id);
  return json({
    settings,
    user: ctx.locals.user,
    /** Дали сървърът има свой ключ — от това зависи нужен ли е ключ от браузъра. */
    hasServerKey: Boolean(env.GEMINI_API_KEY),
    ragBackend: env.RAG_BACKEND === 'gemini' ? 'gemini' : 'vectorize',
  });
});

export const PATCH: APIRoute = handler(async (ctx) => {
  const body = await readJson<{
    responseLanguage?: string;
    offlineMode?: boolean;
    chatModel?: string;
    displayName?: string;
  }>(ctx.request);

  const patch: Parameters<typeof saveSettings>[2] = {};
  if (body.responseLanguage && ALLOWED_LANGUAGES.includes(body.responseLanguage)) {
    patch.responseLanguage = body.responseLanguage;
  }
  if (typeof body.offlineMode === 'boolean') patch.offlineMode = body.offlineMode;
  if (body.chatModel && ALLOWED_MODELS.includes(body.chatModel)) patch.chatModel = body.chatModel;
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
