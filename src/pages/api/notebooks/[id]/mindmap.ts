import type { APIRoute } from 'astro';
import { env, handler, json, ragContext, requireNotebook, selectedSources } from '~/lib/api';
import { HttpError, getMindmap } from '~/lib/db';
import { generateMindmap } from '~/lib/studio';

export const prerender = false;

export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);
  const mindmap = await getMindmap(env.DB, id);
  return json({ mindmap });
});

export const POST: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const notebook = await requireNotebook(ctx, id);

  const sources = await selectedSources(ctx, id);
  if (sources.length === 0) {
    throw new HttpError(400, 'Избери поне един обработен източник.');
  }

  const rag = await ragContext(ctx, notebook);
  const mindmap = await generateMindmap(rag, id, sources);
  return json({ mindmap });
});
