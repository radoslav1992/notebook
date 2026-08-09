import type { APIRoute } from 'astro';
import {
  backendOf,
  bestEffort,
  dropVectors,
  env,
  handler,
  json,
  readJson,
  requireNotebook,
} from '~/lib/api';
import {
  HttpError,
  deleteSource,
  getChunkIdsForSources,
  getSource,
  setSourceSelected,
} from '~/lib/db';

export const prerender = false;

/** Включване/изключване на източник от отговорите. */
export const PATCH: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const sourceId = ctx.params.sourceId!;
  await requireNotebook(ctx, id);

  const body = await readJson<{ selected?: boolean }>(ctx.request);
  if (typeof body.selected !== 'boolean') {
    throw new HttpError(400, 'Очаквах поле `selected`.');
  }
  await setSourceSelected(env.DB, id, [sourceId], body.selected);
  return json({ ok: true });
});

/** Както при тетрадката: външното чистене не може да провали изтриването. */
export const DELETE: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const sourceId = ctx.params.sourceId!;
  await requireNotebook(ctx, id);

  const source = await getSource(env.DB, id, sourceId);
  if (!source) throw new HttpError(404, 'Източникът не е намерен.');

  const chunkIds =
    backendOf() === 'vectorize' ? await getChunkIdsForSources(env.DB, [sourceId]) : [];

  await deleteSource(env.DB, id, sourceId);

  if (chunkIds.length > 0) {
    await bestEffort('vectorize', () => dropVectors(chunkIds));
  }
  if (source.r2Key) {
    await bestEffort('r2 source', () => env.FILES.delete(source.r2Key!));
  }

  return json({ ok: true });
});
