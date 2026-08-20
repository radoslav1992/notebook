import type { APIRoute } from 'astro';
import { env, handler, json, readJson, requireNotebook } from '~/lib/api';
import { allowedDatasetIds, listGrantedDatasets, setNotebookDataset } from '~/lib/datasets';
import { HttpError } from '~/lib/db';

export const prerender = false;

/** Наборите, до които човекът има право; с `notebook` — и дали са включени в нея. */
export const GET: APIRoute = handler(async (ctx) => {
  const notebookId = ctx.url.searchParams.get('notebook') ?? undefined;
  if (notebookId) await requireNotebook(ctx, notebookId);
  return json({
    datasets: await listGrantedDatasets(env.DB, ctx.locals.user.id, notebookId),
  });
});

/** Включва или изключва набор в тетрадка. Правото се проверява в `datasets.ts`. */
export const PATCH: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ notebookId?: string; datasetId?: string; on?: boolean }>(
    ctx.request,
  );
  if (!body.notebookId || !body.datasetId) throw new HttpError(400, 'Липсва тетрадка или набор.');

  await requireNotebook(ctx, body.notebookId);
  await setNotebookDataset(
    env.DB,
    ctx.locals.user.id,
    body.notebookId,
    body.datasetId,
    body.on !== false,
  );

  return json({ datasets: await allowedDatasetIds(env.DB, ctx.locals.user.id, body.notebookId) });
});
