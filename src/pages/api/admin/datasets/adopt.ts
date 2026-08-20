import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { adoptNotebookAsDataset, requireAdmin } from '~/lib/datasets';
import { HttpError } from '~/lib/db';
import { USE_CASES } from '~/lib/prompts';

export const prerender = false;

/**
 * Превръща своя тетрадка в набор — без ново вграждане.
 *
 * Само своя: чужда тетрадка не може да се вземе, дори от админ. Админ правото е
 * за наборите, не за чуждото съдържание.
 */
export const POST: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  const body = await readJson<{ notebookId?: string; blurb?: string; useCases?: string[] }>(
    ctx.request,
  );
  if (!body.notebookId) throw new HttpError(400, 'Липсва тетрадка.');

  const known = new Set(USE_CASES.map((u) => u.value));
  const dataset = await adoptNotebookAsDataset(env.DB, ctx.locals.user.id, body.notebookId, {
    blurb: body.blurb,
    useCases: (body.useCases ?? []).filter((u) => known.has(u as never)),
  });

  return json({ dataset }, { status: 201 });
});
