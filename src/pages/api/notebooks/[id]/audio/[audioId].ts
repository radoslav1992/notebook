import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, requireNotebook } from '~/lib/api';

async function scopedAudio(context: Parameters<APIRoute>[0]) {
  const scope = await requireNotebook(context);
  const audioId = context.params.audioId;
  if (!audioId) throw new HttpError('Missing audio id', 400);
  const audio = await db.getAudio(scope.app.env.DB, audioId);
  if (!audio || audio.notebookId !== scope.notebook.id) {
    throw new HttpError('Audio overview not found', 404);
  }
  return { ...scope, audio };
}

/**
 * Streams the rendered .wav out of R2, with range support so the browser's
 * audio element can seek without downloading the whole file.
 */
export const GET: APIRoute = handler(async (context) => {
  const { app, audio } = await scopedAudio(context);
  if (audio.status !== 'ready' || !audio.r2Key) {
    throw new HttpError('That audio overview is not ready yet', 409);
  }

  const rangeHeader = context.request.headers.get('range');
  const range = parseRange(rangeHeader);
  const object = await app.env.MEDIA.get(audio.r2Key, range ? { range } : undefined);
  if (!object) throw new HttpError('Audio file is missing from storage', 404);

  const headers = new Headers({
    'content-type': 'audio/wav',
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=31536000, immutable',
  });

  if (range && object.range && 'offset' in object.range) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('content-length', String(object.size));
  return new Response(object.body, { headers });
});

export const DELETE: APIRoute = handler(async (context) => {
  const { app, audio } = await scopedAudio(context);
  if (audio.r2Key) app.ctx.waitUntil(app.env.MEDIA.delete(audio.r2Key).catch(() => {}));
  await db.deleteAudio(app.env.DB, audio.id);
  return json({ ok: true });
});

function parseRange(header: string | null): { offset: number; length?: number } | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, startRaw, endRaw] = match;
  if (!startRaw) return null; // suffix ranges are rare enough to just serve whole
  const offset = Number(startRaw);
  if (!Number.isFinite(offset)) return null;
  if (!endRaw) return { offset };
  const end = Number(endRaw);
  if (!Number.isFinite(end) || end < offset) return { offset };
  return { offset, length: end - offset + 1 };
}
