import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { HttpError, type OrgRole } from '~/lib/db';
import { changeRole, removeMember } from '~/lib/orgs';

export const prerender = false;

/**
 * Един член на организация: премахване (или напускане, когато премахваш себе
 * си) и смяна на роля. Кой какво може решават `removeMember` и `changeRole` —
 * правилата са там, за да ги има и тестовете.
 */

export const DELETE: APIRoute = handler(async (ctx) => {
  // „self“ е напускане: интерфейсът не е длъжен да знае собственото си id.
  const target = ctx.params.userId === 'self' ? ctx.locals.user.id : ctx.params.userId!;
  await removeMember(env.DB, ctx.params.id!, ctx.locals.user.id, target);
  return json({ ok: true });
});

export const PATCH: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ role?: string }>(ctx.request);
  if (!body.role) throw new HttpError(400, 'Подай роля.');
  await changeRole(
    env.DB,
    ctx.params.id!,
    ctx.locals.user.id,
    ctx.params.userId!,
    body.role as OrgRole,
  );
  return json({ ok: true });
});
