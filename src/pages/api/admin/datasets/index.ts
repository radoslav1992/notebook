import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { createDataset, listAllDatasets, requireAdmin } from '~/lib/datasets';
import { USE_CASES } from '~/lib/prompts';

export const prerender = false;

export const GET: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  return json({ datasets: await listAllDatasets(env.DB) });
});

export const POST: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  const body = await readJson<{ title?: string; blurb?: string; useCases?: string[] }>(ctx.request);

  // Само познати употреби: непозната стойност не отговаря на нищо в интерфейса и
  // наборът просто спира да излиза, без някой да разбере защо.
  const known = new Set(USE_CASES.map((u) => u.value));
  const useCases = (body.useCases ?? []).filter((u) => known.has(u as never));

  const dataset = await createDataset(env.DB, ctx.locals.user.id, {
    title: body.title ?? '',
    blurb: body.blurb,
    useCases,
  });
  return json({ dataset }, { status: 201 });
});
