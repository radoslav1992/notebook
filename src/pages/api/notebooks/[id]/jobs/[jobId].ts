import type { APIRoute } from 'astro';
import { env, fail, handler, json, requireNotebook } from '~/lib/api';
import { getJob } from '~/lib/db';

export const prerender = false;

/** Напредък на задача в студиото — клиентът я пита през няколко секунди. */
export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const jobId = ctx.params.jobId!;
  await requireNotebook(ctx, id);

  const job = await getJob(env.DB, id, jobId);
  if (!job) return fail(404, 'Задачата не е намерена.');
  return json({ job });
});
