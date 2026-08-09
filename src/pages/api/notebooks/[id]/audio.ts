import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, readJson, requireNotebook } from '~/lib/api';
import { AUDIO_STYLES, runAudioJob } from '~/lib/audio';
import type { AudioFormat } from '~/lib/types';

export const GET: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  return json({ audio: await db.listAudio(app.env.DB, notebook.id) });
});

export const POST: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  const body = await readJson<{ format?: string; focus?: string; sourceIds?: string[] }>(
    context.request,
  );

  const format = (body.format ?? 'deep_dive') as AudioFormat;
  if (!AUDIO_STYLES[format]) throw new HttpError('Unknown audio format', 400);
  if (!notebook.storeName) throw new HttpError('Add a source first', 409);

  const ready = (await db.listSources(app.env.DB, notebook.id)).filter((s) => s.status === 'ready');
  if (!ready.length) throw new HttpError('No indexed sources yet', 409);

  const selected = body.sourceIds?.length
    ? ready.filter((s) => body.sourceIds!.includes(s.id))
    : ready;
  if (!selected.length) throw new HttpError('Select at least one source', 400);

  const job = await db.insertAudio(app.env.DB, {
    notebookId: notebook.id,
    format,
    focus: body.focus?.trim() || null,
  });

  // Scripting + synthesis run past the response; the client polls /state.
  app.ctx.waitUntil(
    runAudioJob(app, {
      id: job.id,
      notebookId: notebook.id,
      storeName: notebook.storeName,
      format,
      focus: job.focus,
      selectedSourceIds: selected.map((s) => s.id),
      allSourceIds: ready.map((s) => s.id),
    }),
  );

  return json({ audio: job }, { status: 202 });
});
