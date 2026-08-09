import type { APIRoute } from 'astro';
import { requireGoogleFeature } from '~/lib/ai';
import {
  backendOf,
  bestEffort,
  dropVectors,
  env,
  ai,
  handler,
  json,
  readJson,
  requireNotebook,
} from '~/lib/api';
import {
  deleteNotebook,
  getChunkIdsForSources,
  getLatestJob,
  getMindmap,
  listMessages,
  listNotes,
  listSources,
  updateNotebook,
} from '~/lib/db';

export const prerender = false;

/** Пълното състояние на една тетрадка — един рунд-трип при отваряне. */
export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const notebook = await requireNotebook(ctx, id);
  const db = env.DB;

  const [sources, messages, notes, audioJob, mindmap] = await Promise.all([
    listSources(db, id),
    listMessages(db, id),
    listNotes(db, id),
    getLatestJob(db, id, 'audio'),
    getMindmap(db, id),
  ]);

  return json({ notebook, sources, messages, notes, audioJob, mindmap });
});

export const PATCH: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);
  const body = await readJson<{ title?: string; emoji?: string; blurb?: string }>(ctx.request);
  await updateNotebook(env.DB, ctx.locals.user.id, id, body);
  const notebook = await requireNotebook(ctx, id);
  return json({ notebook });
});

/**
 * Изтрива тетрадката с всичко нейно.
 *
 * Редът е нарочен: първо събираме какво трябва да се изчисти, после трием от
 * D1, и накрая пипаме външните ресурси „по възможност“. Така изтриването винаги
 * успява, дори Vectorize, R2 или Google да са недостъпни — един изоставен
 * вектор е по-малката беда от тетрадка, която не се трие.
 */
export const DELETE: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const notebook = await requireNotebook(ctx, id);

  const sources = await listSources(env.DB, id);
  const r2Keys = sources.map((s) => s.r2Key).filter((k): k is string => Boolean(k));
  const chunkIds =
    backendOf() === 'vectorize'
      ? await getChunkIdsForSources(
          env.DB,
          sources.map((s) => s.id),
        )
      : [];

  await deleteNotebook(env.DB, ctx.locals.user.id, id);

  if (chunkIds.length > 0) {
    await bestEffort('vectorize', () => dropVectors(chunkIds));
  }
  if (r2Keys.length > 0) {
    await bestEffort('r2 sources', () => env.FILES.delete(r2Keys));
  }
  await bestEffort('r2 audio', async () => {
    const listed = await env.FILES.list({ prefix: `audio/${id}/` });
    if (listed.objects.length > 0) {
      await env.FILES.delete(listed.objects.map((o) => o.key));
    }
  });
  if (notebook.storeName && backendOf() === 'gemini') {
    await bestEffort('file search store', () =>
      requireGoogleFeature(ai(ctx), 'File Search').deleteFileSearchStore(notebook.storeName!),
    );
  }

  return json({ ok: true });
});
