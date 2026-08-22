import type { APIRoute } from 'astro';
import { bestEffort, dropVectors, env, handler, json, readJson } from '~/lib/api';
import { grantDataset, publishDataset, renameDataset, requireAdmin, setDatasetPublic, updateDatasetMeta } from '~/lib/datasets';
import { findUserByEmail } from '~/lib/auth';
import { HttpError, deleteDatasetNotebook, getChunkIdsForSources, getDatasetNotebook, listSources } from '~/lib/db';
import { USE_CASES } from '~/lib/prompts';

export const prerender = false;

export const PATCH: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  const id = ctx.params.id!;
  const body = await readJson<{
    title?: string;
    blurb?: string;
    useCases?: string[];
    published?: boolean;
    isPublic?: boolean;
    grantTo?: string;
  }>(ctx.request);

  if (body.title !== undefined) {
    await renameDataset(env.DB, id, body.title);
  }

  if (body.blurb !== undefined || body.useCases !== undefined) {
    const known = new Set(USE_CASES.map((u) => u.value));
    await updateDatasetMeta(env.DB, id, {
      blurb: body.blurb,
      useCases: body.useCases?.filter((u) => known.has(u as never)),
    });
  }

  if (typeof body.published === 'boolean') {
    await publishDataset(env.DB, id, body.published);
  }

  if (typeof body.isPublic === 'boolean') {
    await setDatasetPublic(env.DB, id, body.isPublic);
  }

  // Даването на достъп е тук, докато няма плащане. После същата функция ще се
  // вика от webhook-а — затова живее в `datasets.ts`, не в този маршрут.
  if (body.grantTo) {
    const user = await findUserByEmail(env.DB, body.grantTo);
    if (!user) throw new HttpError(404, `Няма профил с имейл ${body.grantTo}.`);
    await grantDataset(env.DB, user.id, id);
  }

  return json({ ok: true });
});

/**
 * Изтрива набор — с векторите и файловете му.
 *
 * Съществува и защото изтриването на профил отказва, докато профилът притежава
 * набори: съобщението праща тук и без този маршрут щеше да сочи задънена улица.
 * Личните тетрадки минават по своя маршрут; той не хваща набори (`getNotebook`
 * връща само `kind='personal'`), затова това е отделен път с отделна проверка.
 */
export const DELETE: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  const id = ctx.params.id!;
  const dataset = await getDatasetNotebook(env.DB, id);
  if (!dataset) throw new HttpError(404, 'Наборът не е намерен.');

  const sources = await listSources(env.DB, id);
  const r2Keys = sources.map((s) => s.r2Key).filter((k): k is string => Boolean(k));
  const chunkIds = await getChunkIdsForSources(
    env.DB,
    sources.map((s) => s.id),
  );

  // Без филтър по собственик: наборът е на платформата, а създателят му може да
  // е друг админ. Правото е проверено горе с requireAdmin.
  await deleteDatasetNotebook(env.DB, id);

  if (chunkIds.length > 0) {
    await bestEffort('vectorize', () => dropVectors(chunkIds));
  }
  if (r2Keys.length > 0) {
    await bestEffort('r2 sources', () => env.FILES.delete(r2Keys));
  }

  return json({ ok: true });
});
