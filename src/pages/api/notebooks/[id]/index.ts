import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { deleteStore } from '~/lib/gemini';
import { handler, json, readJson, requireNotebook } from '~/lib/api';

export const PATCH: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  const body = await readJson<{ title?: string; emoji?: string; description?: string }>(
    context.request,
  );

  await db.updateNotebook(app.env.DB, notebook.id, {
    ...(body.title !== undefined ? { title: body.title.trim().slice(0, 200) || 'Untitled notebook' } : {}),
    ...(body.emoji !== undefined ? { emoji: body.emoji.slice(0, 8) } : {}),
    ...(body.description !== undefined ? { description: body.description.slice(0, 4000) } : {}),
  });

  return json({ notebook: await db.getNotebook(app.env.DB, notebook.id, notebook.ownerId) });
});

export const DELETE: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);

  // Collect the blob keys *before* dropping the rows that point at them —
  // the background cleanup would otherwise race the delete and find nothing.
  const sources = await db.listSources(app.env.DB, notebook.id);
  const audio = await db.listAudio(app.env.DB, notebook.id);
  const keys: string[] = [];
  for (const s of sources) {
    const full = await db.getSource(app.env.DB, s.id);
    if (full?.r2Key) keys.push(full.r2Key);
  }
  for (const a of audio) {
    const full = await db.getAudio(app.env.DB, a.id);
    if (full?.r2Key) keys.push(full.r2Key);
  }

  await db.deleteNotebook(app.env.DB, notebook.id);

  app.ctx.waitUntil(
    (async () => {
      await Promise.allSettled(keys.map((k) => app.env.MEDIA.delete(k)));
      if (notebook.storeName) {
        await deleteStore(app.gemini, notebook.storeName).catch(() => {});
      }
    })(),
  );
  return json({ ok: true });
});
