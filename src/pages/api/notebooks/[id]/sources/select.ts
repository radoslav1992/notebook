import type { APIRoute } from 'astro';
import { env, handler, json, readJson, requireNotebook } from '~/lib/api';
import { listSources, setSourceSelected } from '~/lib/db';

export const prerender = false;

/** „Избери всички“ / „Изчисти избора“ с една заявка. */
export const POST: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);
  const body = await readJson<{ selected: boolean }>(ctx.request);
  const db = env.DB;

  const sources = await listSources(db, id);
  await setSourceSelected(
    db,
    id,
    sources.map((s) => s.id),
    Boolean(body.selected),
  );
  return json({ ok: true });
});
