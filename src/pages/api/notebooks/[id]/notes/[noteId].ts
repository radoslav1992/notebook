import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, readJson, requireNotebook } from '~/lib/api';

async function scopedNote(context: Parameters<APIRoute>[0]) {
  const scope = await requireNotebook(context);
  const noteId = context.params.noteId;
  if (!noteId) throw new HttpError('Missing note id', 400);
  const notes = await db.listNotes(scope.app.env.DB, scope.notebook.id);
  const note = notes.find((n) => n.id === noteId);
  if (!note) throw new HttpError('Note not found', 404);
  return { ...scope, note };
}

export const PATCH: APIRoute = handler(async (context) => {
  const { app, note } = await scopedNote(context);
  const body = await readJson<{ title?: string; content?: string }>(context.request);
  await db.updateNote(app.env.DB, note.id, {
    ...(body.title !== undefined ? { title: body.title.trim().slice(0, 200) || note.title } : {}),
    ...(body.content !== undefined ? { content: body.content.slice(0, 200_000) } : {}),
  });
  const notes = await db.listNotes(app.env.DB, note.notebookId);
  return json({ note: notes.find((n) => n.id === note.id) });
});

export const DELETE: APIRoute = handler(async (context) => {
  const { app, note } = await scopedNote(context);
  await db.deleteNote(app.env.DB, note.id);
  return json({ ok: true });
});
