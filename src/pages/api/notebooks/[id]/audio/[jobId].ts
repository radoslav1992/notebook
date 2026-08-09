import type { APIRoute } from 'astro';
import { env, handler, requireNotebook } from '~/lib/api';
import { getJobR2Key } from '~/lib/db';

export const prerender = false;

/**
 * Отдава готовия WAV файл. Поддържа Range заявки, защото <audio> разчита
 * на тях, за да превърта без да тегли всичко.
 */
export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  const jobId = ctx.params.jobId!;
  await requireNotebook(ctx, id);

  const key = await getJobR2Key(env.DB, id, jobId);
  if (!key) {
    return new Response('Няма готово аудио за тази задача.', { status: 404 });
  }

  const range = ctx.request.headers.get('range');
  const object = await env.FILES.get(key, range ? { range: ctx.request.headers } : undefined);
  if (!object) {
    return new Response('Файлът липсва в хранилището.', { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('content-type', 'audio/wav');
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=3600');

  if (object.range && 'offset' in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(object.body, { headers });
});
