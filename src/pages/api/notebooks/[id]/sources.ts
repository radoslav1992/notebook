import type { APIRoute } from 'astro';
import * as db from '~/lib/db';
import { HttpError, handler, json, requireNotebook } from '~/lib/api';
import {
  MAX_SOURCE_BYTES,
  ensureStore,
  fetchWebPage,
  ingestSource,
  isYouTube,
  normalizeMime,
  transcribeYouTube,
} from '~/lib/ingest';
import { newId } from '~/lib/ids';

const TEXTUAL = /^(text\/|application\/json$)/;

export const GET: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  return json({ sources: await db.listSources(app.env.DB, notebook.id) });
});

export const POST: APIRoute = handler(async (context) => {
  const { app, notebook } = await requireNotebook(context);
  const storeName = await ensureStore(app, notebook);
  const contentType = context.request.headers.get('content-type') ?? '';

  const created: string[] = [];

  if (contentType.includes('multipart/form-data')) {
    const form = await context.request.formData();
    const files = form.getAll('files').filter((f): f is File => f instanceof File);
    if (!files.length) throw new HttpError('No files were uploaded', 400);

    for (const file of files) {
      if (file.size === 0) continue;
      if (file.size > MAX_SOURCE_BYTES) {
        throw new HttpError(
          `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${MAX_SOURCE_BYTES / 1024 / 1024} MB`,
          413,
        );
      }

      const bytes = await file.arrayBuffer();
      const mimeType = normalizeMime(file.name, file.type);
      const r2Key = `sources/${notebook.id}/${newId('f')}-${safeName(file.name)}`;
      await app.env.MEDIA.put(r2Key, bytes, {
        httpMetadata: { contentType: file.type || mimeType },
      });

      created.push(
        await ingestSource(app, {
          notebookId: notebook.id,
          storeName,
          title: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || file.name,
          kind: 'file',
          mimeType,
          bytes,
          r2Key,
          preview: TEXTUAL.test(mimeType) ? decodeText(bytes) : null,
        }),
      );
    }
  } else {
    const body = (await context.request.json().catch(() => null)) as {
      kind?: 'text' | 'url';
      text?: string;
      title?: string;
      url?: string;
    } | null;
    if (!body) throw new HttpError('Expected a JSON body', 400);

    if (body.kind === 'text') {
      const text = (body.text ?? '').trim();
      if (text.length < 20) throw new HttpError('Paste at least a couple of sentences', 400);
      created.push(
        await ingestSource(app, {
          notebookId: notebook.id,
          storeName,
          title: (body.title?.trim() || firstLine(text)).slice(0, 200),
          kind: 'text',
          mimeType: 'text/plain',
          bytes: new TextEncoder().encode(text).buffer as ArrayBuffer,
          preview: text,
        }),
      );
    } else if (body.kind === 'url') {
      const url = (body.url ?? '').trim();
      if (!/^https?:\/\//i.test(url)) throw new HttpError('Enter a full http(s) URL', 400);

      const youtube = isYouTube(url);
      const { title, text } = youtube
        ? await transcribeYouTube(app, url)
        : await fetchWebPage(url);

      created.push(
        await ingestSource(app, {
          notebookId: notebook.id,
          storeName,
          title: (body.title?.trim() || title).slice(0, 200),
          kind: youtube ? 'youtube' : 'url',
          mimeType: 'text/plain',
          bytes: new TextEncoder().encode(text).buffer as ArrayBuffer,
          originUrl: url,
          preview: text,
        }),
      );
    } else {
      throw new HttpError('Unsupported source kind', 400);
    }
  }

  if (!created.length) throw new HttpError('Nothing to add', 400);
  await db.touchNotebook(app.env.DB, notebook.id);

  return json(
    { sourceIds: created, sources: await db.listSources(app.env.DB, notebook.id) },
    { status: 201 },
  );
});

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
}

function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) ?? 'Pasted text';
  return line.trim().slice(0, 80);
}

function decodeText(bytes: ArrayBuffer): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes).slice(0, 200_000);
  } catch {
    return null;
  }
}
