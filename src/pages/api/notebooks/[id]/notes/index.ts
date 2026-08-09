import type { APIRoute } from 'astro';
import {
  env,
  handler,
  json,
  ragContext,
  readJson,
  requireNotebook,
  selectedSources,
} from '~/lib/api';
import { HttpError, createNote, listNotes, touchNotebook } from '~/lib/db';
import { STUDIO_TASKS, type StudioTaskKey } from '~/lib/prompts';
import { generateStudioNote } from '~/lib/studio';

export const prerender = false;

export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);
  const notes = await listNotes(env.DB, id);
  return json({ notes });
});

/**
 * Две неща в един маршрут:
 *   { task: 'study_guide' } → материал, генериран от източниците
 *   { title, body }         → ръчна бележка
 */
export const POST: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const notebook = await requireNotebook(ctx, id);

  const body = await readJson<{ task?: string; title?: string; body?: string }>(ctx.request);

  if (body.task) {
    if (!(body.task in STUDIO_TASKS)) {
      throw new HttpError(400, `Непознат материал: ${body.task}`);
    }
    const sources = await selectedSources(id);
    if (sources.length === 0) {
      throw new HttpError(400, 'Избери поне един обработен източник.');
    }
    const rag = await ragContext(ctx, notebook);
    const note = await generateStudioNote(rag, id, sources, body.task as StudioTaskKey);
    await touchNotebook(env.DB, id);
    return json({ note }, { status: 201 });
  }

  const note = await createNote(env.DB, id, {
    title: body.title?.trim() || 'Нова бележка',
    body: body.body ?? '',
  });
  await touchNotebook(env.DB, id);
  return json({ note }, { status: 201 });
});
