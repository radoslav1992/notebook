import type { APIRoute } from 'astro';
import { bestEffort, dropVectors, env, handler, json } from '~/lib/api';
import { deleteOrgRows, getChunkIdsForSources, listSources } from '~/lib/db';
import { requireOrgOwner } from '~/lib/orgs';

export const prerender = false;

/**
 * Изтрива организацията — с библиотеката, индекса и файловете ѝ. Само
 * собственикът. Личните тетрадки на членовете не се пипат: губят само
 * включените библиотечни източници, които вече ги няма.
 */
export const DELETE: APIRoute = handler(async (ctx) => {
  const orgId = ctx.params.id!;
  const { libraryId } = await requireOrgOwner(env.DB, orgId, ctx.locals.user.id);

  const sources = libraryId ? await listSources(env.DB, libraryId) : [];
  const r2Keys = sources.map((s) => s.r2Key).filter((k): k is string => Boolean(k));
  const chunkIds = await getChunkIdsForSources(
    env.DB,
    sources.map((s) => s.id),
  );

  await deleteOrgRows(env.DB, orgId, libraryId);

  if (chunkIds.length > 0) {
    await bestEffort('vectorize', () => dropVectors(chunkIds));
  }
  if (r2Keys.length > 0) {
    await bestEffort('r2 sources', () => env.FILES.delete(r2Keys));
  }

  return json({ ok: true });
});
