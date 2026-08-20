import type { APIRoute } from 'astro';
import { requireGoogleFeature } from '~/lib/ai';
import {
  backendOf,
  background,
  env,
  ai,
  handler,
  ingestContext,
  json,
  requireNotebook,
  requireVerified,
} from '~/lib/api';
import {
  HttpError,
  createSource,
  failStaleSources,
  getChunksForSources,
  listSources,
  touchNotebook,
  updateNotebook,
} from '~/lib/db';
import { MAX_UPLOAD_BYTES, ingestSource, kindForFile, kindForUrl } from '~/lib/ingest';
import { NOTEBOOK_NAMING_SCHEMA, notebookNamingPrompt } from '~/lib/prompts';
import { newId } from '~/lib/ids';
import type { Notebook, Source } from '~/lib/types';

export const prerender = false;

export const GET: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  await requireNotebook(ctx, id, { library: 'read' });
  // Точно този маршрут върти опресняването — тук закъсалото трябва да се обяви.
  await failStaleSources(env.DB, id);
  const sources = await listSources(env.DB, id);
  return json({ sources });
});

export const POST: APIRoute = handler(async (ctx) => {
  const id = ctx.params.id!;
  let notebook = await requireNotebook(ctx, id, { library: 'write' });

  // Качването плаща за вграждания, значи иска потвърден имейл като останалите.
  requireVerified(ctx);

  // Моделите се сглобяват преди каквито и да е записи: липсващ ключ или
  // липсващ binding трябва да се разбере сега, а не да остави източник във
  // „pending“, който никога няма да бъде обработен.
  ai(ctx);

  // При управляван RAG хранилището се създава при първия източник.
  if (backendOf() === 'gemini' && !notebook.storeName) {
    const storeName = await requireGoogleFeature(ai(ctx), 'File Search').createFileSearchStore(
      `zapiski-${id}`,
    );
    await updateNotebook(env.DB, ctx.locals.user.id, id, { storeName });
    notebook = { ...notebook, storeName };
  }

  const contentType = ctx.request.headers.get('content-type') ?? '';
  const created: Source[] = contentType.includes('multipart/form-data')
    ? await addFiles(ctx, notebook)
    : await addFromJson(ctx, notebook);

  if (created.length === 0) {
    throw new HttpError(400, 'Не получих нито един източник.');
  }

  await touchNotebook(env.DB, id);

  const ingest = ingestContext(ctx, notebook);
  background(
    (async () => {
      for (const source of created) {
        await ingestSource(ingest, source);
      }
      await autoNameNotebook(ctx, notebook);
    })(),
  );

  return json({ sources: created }, { status: 202 });
});

/* ── файлове ─────────────────────────────────────────────────────────────── */

async function addFiles(
  ctx: Parameters<APIRoute>[0],
  notebook: Notebook,
): Promise<Source[]> {
  const form = await ctx.request.formData();
  const entries = form.getAll('files').filter((f): f is File => f instanceof File);
  if (entries.length === 0) throw new HttpError(400, 'Няма прикачени файлове.');

  const out: Source[] = [];

  for (const file of entries) {
    if (file.size === 0) continue;
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(
        413,
        `„${file.name}“ е ${Math.round(file.size / 1e6)} MB — таванът е ${Math.round(
          MAX_UPLOAD_BYTES / 1e6,
        )} MB.`,
      );
    }

    const kind = kindForFile(file.name, file.type);
    const r2Key = `sources/${notebook.id}/${newId('f')}-${safeName(file.name)}`;
    await env.FILES.put(r2Key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    out.push(
      await createSource(env.DB, notebook.id, {
        kind,
        name: file.name,
        sub: 'обработва се…',
        r2Key,
        byteSize: file.size,
      }),
    );
  }
  return out;
}

/* ── линк или текст ──────────────────────────────────────────────────────── */

async function addFromJson(
  ctx: Parameters<APIRoute>[0],
  notebook: Notebook,
): Promise<Source[]> {
  const body = (await ctx.request.json().catch(() => ({}))) as {
    url?: string;
    text?: string;
    name?: string;
  };

  if (body.url) {
    const url = normalizeUrl(body.url);
    const kind = kindForUrl(url);
    return [
      await createSource(env.DB, notebook.id, {
        kind,
        name: kind === 'YT' ? body.name?.trim() || 'YouTube видео' : hostPath(url),
        sub: 'обработва се…',
        originUrl: url,
      }),
    ];
  }

  const text = body.text?.trim();
  if (text) {
    if (text.length < 40) throw new HttpError(400, 'Текстът е твърде кратък, за да е източник.');
    const r2Key = `sources/${notebook.id}/${newId('t')}.txt`;
    const bytes = new TextEncoder().encode(text);
    await env.FILES.put(r2Key, bytes as unknown as ArrayBuffer, {
      httpMetadata: { contentType: 'text/plain; charset=utf-8' },
    });
    return [
      await createSource(env.DB, notebook.id, {
        kind: 'TXT',
        name: body.name?.trim() || firstLineAsName(text),
        sub: 'обработва се…',
        r2Key,
        byteSize: bytes.byteLength,
      }),
    ];
  }

  throw new HttpError(400, 'Подай `url` или `text`.');
}

/* ── автоматично име на тетрадката ───────────────────────────────────────── */

/**
 * „Нова тетрадка“ е неинформативно име. След като първият източник е готов,
 * измисляме заглавие, емоджи и подзаглавие по съдържанието му.
 */
async function autoNameNotebook(
  ctx: Parameters<APIRoute>[0],
  notebook: Notebook,
): Promise<void> {
  if (notebook.title !== 'Нова тетрадка' && notebook.title.trim() !== '') return;

  const sources = await listSources(env.DB, notebook.id);
  const ready = sources.filter((s) => s.status === 'ready');
  if (ready.length === 0) return;

  const chunks = await getChunksForSources(
    env.DB,
    ready.map((s) => s.id),
    6,
  );
  const sample = chunks
    .map((c) => c.text)
    .join('\n\n')
    .slice(0, 6000);
  if (sample.length < 100) return;

  try {
    const named = await ai(ctx).chat.generateJson<{ title: string; emoji: string; blurb: string }>({
      prompt: `Източник: „${ready[0]!.name}“\n\nНачало на текста:\n${sample}\n\n---\n\n${notebookNamingPrompt(
        env.RESPONSE_LANGUAGE || 'bg',
      )}`,
      schema: NOTEBOOK_NAMING_SCHEMA,
    });
    await updateNotebook(env.DB, ctx.locals.user.id, notebook.id, {
      title: named.title.slice(0, 90),
      emoji: [...named.emoji].slice(0, 2).join('') || '📓',
      blurb: named.blurb.slice(0, 140),
    });
  } catch (err) {
    console.error('[zapiski] auto-name', err);
  }
}

/* ── помощни ─────────────────────────────────────────────────────────────── */

function normalizeUrl(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new HttpError(400, 'Адресът не е валиден.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'Приемам само http(s) адреси.');
  }
  // Не пускаме заявки към вътрешната мрежа през нашия worker.
  const host = url.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '::1' ||
    host.endsWith('.localhost') ||
    host.endsWith('.internal') ||
    /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  ) {
    throw new HttpError(400, 'Този адрес не е достъпен.');
  }
  return url.toString();
}

function hostPath(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
    return `${u.host}${path}`.slice(0, 120);
  } catch {
    return url.slice(0, 120);
  }
}

function firstLineAsName(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 3)?.trim() ?? 'Поставен текст';
  return line.length <= 60 ? line : `${line.slice(0, 59)}…`;
}

function safeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[^\w.\-]+/g, '_')
    .slice(-80);
}
