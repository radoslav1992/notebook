import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, readJson, requireNotebook } from '~/lib/api';
import { deleteDocument } from '~/lib/gemini';

async function scopedSource(context: Parameters<APIRoute>[0]) {
  const scope = await requireNotebook(context);
  const sourceId = context.params.sourceId;
  if (!sourceId) throw new HttpError('Missing source id', 400);
  const source = await db.getSource(scope.app.env.DB, sourceId);
  if (!source || source.notebookId !== scope.notebook.id) {
    throw new HttpError('Source not found', 404);
  }
  return { ...scope, source };
}

/** Full text of a source, for the citation viewer. */
export const GET: APIRoute = handler(async (context) => {
  const { source } = await scopedSource(context);
  return json({ source });
});

export const PATCH: APIRoute = handler(async (context) => {
  const { app, source } = await scopedSource(context);
  const body = await readJson<{ title?: string }>(context.request);
  if (body.title !== undefined) {
    await db.updateSource(app.env.DB, source.id, {
      title: body.title.trim().slice(0, 200) || source.title,
    });
  }
  return json({ source: await db.getSource(app.env.DB, source.id) });
});

export const DELETE: APIRoute = handler(async (context) => {
  const { app, source } = await scopedSource(context);

  app.ctx.waitUntil(
    (async () => {
      if (source.r2Key) await app.env.MEDIA.delete(source.r2Key).catch(() => {});
      if (source.docName) await deleteDocument(app.gemini, source.docName).catch(() => {});
    })(),
  );

  await db.deleteSource(app.env.DB, source.id);
  return json({ ok: true });
});
