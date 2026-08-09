import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, readJson, requireNotebook } from '~/lib/api';
import type { NoteKind } from '~/lib/types';

export const GET: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  return json({ notes: await db.listNotes(app.env.DB, notebook.id) });
});

export const POST: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  const body = await readJson<{ title?: string; content?: string; kind?: NoteKind }>(
    context.request,
  );

  const content = (body.content ?? '').trim();
  if (!content) throw new HttpError('A note needs some content', 400);

  const note = await db.insertNote(app.env.DB, {
    notebookId: notebook.id,
    title: (body.title?.trim() || content.split('\n')[0]).slice(0, 200),
    content: content.slice(0, 200_000),
    kind: body.kind ?? 'note',
  });
  await db.touchNotebook(app.env.DB, notebook.id);
  return json({ note }, { status: 201 });
});
