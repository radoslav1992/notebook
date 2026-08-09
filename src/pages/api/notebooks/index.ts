import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { getRuntime } from '~/lib/env';
import { getOwnerId } from '~/lib/session';
import { handler, json, readJson } from '~/lib/api';

export const GET: APIRoute = handler(async (context) => {
  const app = getRuntime(context);
  const ownerId = await getOwnerId(context);
  const notebooks = await db.listNotebooks(app.env.DB, ownerId);
  const counts = await db.countSourcesByNotebook(
    app.env.DB,
    notebooks.map((n) => n.id),
  );
  return json({ notebooks: notebooks.map((n) => ({ ...n, sourceCount: counts[n.id] ?? 0 })) });
});

export const POST: APIRoute = handler(async (context) => {
  const app = getRuntime(context);
  const ownerId = await getOwnerId(context);
  const body = await readJson<{ title?: string }>(context.request).catch(() => ({ title: undefined }));
  const notebook = await db.createNotebook(app.env.DB, { ownerId, title: body.title });
  return json({ notebook }, { status: 201 });
});
