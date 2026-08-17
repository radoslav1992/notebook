import type { APIRoute } from 'astro';
import {
  background,
  env,
  handler,
  json,
  ragContext,
  readJson,
  requireNotebook,
  requireVerified,
  selectedSources,
} from '~/lib/api';
import { HttpError, createJob, failStaleJob, getLatestJob, isJobStale, updateJob } from '~/lib/db';
import { assertCanMakeAudio, countAudio, getEntitlement } from '~/lib/limits';
import { generateAudioOverview } from '~/lib/studio';

export const prerender = false;

export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id);
  const job = await getLatestJob(env.DB, id, 'audio');
  return json({ job });
});

/**
 * Пуска генерирането на аудио преглед. Отнема минута-две, затова връщаме
 * веднага номер на задача, а работата продължава във фонов режим.
 * Клиентът следи напредъка през /api/notebooks/:id/jobs/:jobId.
 */
export const POST: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const notebook = await requireNotebook(ctx, id);

  const existing = await getLatestJob(env.DB, id, 'audio');
  if (existing && (existing.status === 'queued' || existing.status === 'running')) {
    // Задача, чиято изолата е била прекратена, остава „running“ завинаги и без
    // това щеше да блокира всеки следващ опит. Отписваме я и продължаваме.
    if (isJobStale(existing)) {
      await failStaleJob(env.DB, existing);
    } else {
      return json({ job: existing, alreadyRunning: true });
    }
  }

  requireVerified(ctx);
  await assertCanMakeAudio(env.DB, ctx.locals.user.id);

  const sources = await selectedSources(ctx, id);
  if (sources.length === 0) {
    throw new HttpError(400, 'Избери поне един обработен източник.');
  }

  const body = await readJson<{ minutes?: number }>(ctx.request).catch(() => ({ minutes: 8 }));
  const entitlement = await getEntitlement(env.DB, ctx.locals.user.id);
  const minutes = Math.min(body.minutes ?? 2, entitlement.plan.limits.audioMinutes);

  const rag = await ragContext(ctx, notebook);
  const job = await createJob(env.DB, id, 'audio');
  await countAudio(env.DB, ctx.locals.user.id);

  background(
    generateAudioOverview(rag, {
      jobId: job.id,
      notebookId: id,
      sources,
      files: env.FILES,
      minutes,
    }).catch(async (err: unknown) => {
      const message = err instanceof Error ? err.message : 'Генерирането се провали.';
      console.error('[zapiski:audio]', err);
      await updateJob(env.DB, job.id, {
        status: 'error',
        step: '',
        error: message.slice(0, 500),
      });
    }),
  );

  return json({ job }, { status: 202 });
});
