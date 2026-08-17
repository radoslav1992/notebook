import type { APIRoute } from 'astro';
import { env, handler, json, readJson, requireNotebook } from '~/lib/api';
import { HttpError, listSources, setLibrarySource } from '~/lib/db';
import { listOrgs, requireLibraryRole } from '~/lib/orgs';

export const prerender = false;

/** Кои общи източници са налични за тази тетрадка и кои вече са включени. */
export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);

  const orgs = await listOrgs(env.DB, ctx.locals.user.id);
  const { results } = await env.DB
    .prepare('SELECT source_id FROM notebook_library_sources WHERE notebook_id = ?')
    .bind(id)
    .all<{ source_id: string }>();
  const on = new Set((results ?? []).map((r) => r.source_id));

  const libraries = await Promise.all(
    orgs.map(async (org) => ({
      orgId: org.id,
      orgName: org.name,
      role: org.role,
      sources: (await listSources(env.DB, org.libraryId))
        .filter((s) => s.status === 'ready')
        .map((s) => ({ id: s.id, name: s.name, kind: s.kind, sub: s.sub, on: on.has(s.id) })),
    })),
  );

  return json({ libraries });
});

/**
 * Включва или изключва общ източник в тетрадката.
 *
 * Членството се проверява ТУК, а не се приема от интерфейса: иначе всеки може да
 * закачи чужд източник по id и после да го чете през своята тетрадка. Втора
 * проверка има и при извличането (`listAllowedSources`), но да разчиташ само на
 * нея значи да пазиш в базата връзки, които не бива да съществуват.
 */
export const PATCH: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);
  const body = await readJson<{ sourceId?: string; on?: boolean }>(ctx.request);
  if (!body.sourceId) throw new HttpError(400, 'Липсва източник.');

  const row = await env.DB
    .prepare(
      `SELECT s.notebook_id FROM sources s JOIN notebooks n ON n.id = s.notebook_id
       WHERE s.id = ? AND n.kind = 'library'`,
    )
    .bind(body.sourceId)
    .first<{ notebook_id: string }>();
  if (!row) throw new HttpError(404, 'Източникът не е намерен в библиотека.');

  await requireLibraryRole(env.DB, ctx.locals.user.id, row.notebook_id);
  await setLibrarySource(env.DB, id, body.sourceId, body.on !== false);

  return json({ ok: true });
});
