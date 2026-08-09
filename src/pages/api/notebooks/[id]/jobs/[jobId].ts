import type { APIRoute } from 'astro';
import { env, fail, handler, json, requireNotebook } from '~/lib/api';
import { failStaleJob, getJob, isJobStale } from '~/lib/db';

export const prerender = false;

/** Напредък на задача в студиото — клиентът я пита през няколко секунди. */
export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const jobId = ctx.params.jobId!;
  await requireNotebook(ctx, id);

  const job = await getJob(env.DB, id, jobId);
  if (!job) return fail(404, 'Задачата не е намерена.');

  // Задача, която е спряла да отчита напредък, е умряла с изолата си. Тук е
  // единственото място, което го забелязва — иначе интерфейсът върти вечно.
  if (isJobStale(job)) return json({ job: await failStaleJob(env.DB, job) });

  return json({ job });
});
