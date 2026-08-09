import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { createNotebook, listNotebooks } from '~/lib/db';
import { assertCanCreateNotebook } from '~/lib/limits';

export const prerender = false;

export const GET: APIRoute = handler(async (ctx) => {
  const notebooks = await listNotebooks(env.DB, ctx.locals.user.id);
  return json({ notebooks });
});

export const POST: APIRoute = handler(async (ctx) => {
  await assertCanCreateNotebook(env.DB, ctx.locals.user.id);
  const body = await readJson<{ title?: string; emoji?: string; blurb?: string }>(ctx.request).catch(
    () => ({}) as { title?: string },
  );
  const notebook = await createNotebook(env.DB, ctx.locals.user.id, body);
  return json({ notebook }, { status: 201 });
});
