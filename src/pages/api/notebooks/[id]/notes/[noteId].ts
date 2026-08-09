import type { APIRoute } from 'astro';
import { env, handler, json, readJson, requireNotebook } from '~/lib/api';
import { deleteNote, updateNote } from '~/lib/db';

export const prerender = false;

export const PATCH: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const noteId = ctx.params.noteId!;
  await requireNotebook(ctx, id);
  const body = await readJson<{ title?: string; body?: string }>(ctx.request);
  await updateNote(env.DB, id, noteId, body);
  return json({ ok: true });
});

export const DELETE: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const noteId = ctx.params.noteId!;
  await requireNotebook(ctx, id);
  await deleteNote(env.DB, id, noteId);
  return json({ ok: true });
});
