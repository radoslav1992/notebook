import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { handler, json, requireNotebook } from '~/lib/api';

/**
 * One call returns everything the notebook view renders. The client polls this
 * while sources are indexing or audio is rendering.
 */
export const GET: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  const [sources, messages, notes, audio] = await Promise.all([
    db.listSources(app.env.DB, notebook.id),
    db.listMessages(app.env.DB, notebook.id),
    db.listNotes(app.env.DB, notebook.id),
    db.listAudio(app.env.DB, notebook.id),
  ]);
  return json({ notebook, sources, messages, notes, audio });
});
