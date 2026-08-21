import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { requireAdmin } from '~/lib/datasets';
import { HttpError } from '~/lib/db';
import { listOrgsAdmin, setOrgSeats } from '~/lib/orgs';
import { BUSINESS, currentPeriod } from '~/lib/plans';

export const prerender = false;

async function listing() {
  const orgs = await listOrgsAdmin(env.DB, currentPeriod());
  return orgs.map((o) => ({
    ...o,
    questionsTotal: o.seats * BUSINESS.questionsPerSeat,
  }));
}

export const GET: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  return json({ orgs: await listing() });
});

export const PATCH: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  const body = await readJson<{ orgId?: string; seats?: number }>(ctx.request);
  if (!body.orgId) throw new HttpError(400, 'Подай организация.');
  await setOrgSeats(env.DB, body.orgId, body.seats ?? Number.NaN);
  return json({ orgs: await listing() });
});
