import { env, waitUntil } from 'cloudflare:workers';
import type { APIContext } from 'astro';
import { Gemini, GeminiError } from './gemini';
import { HttpError, getNotebook, getSettings, listSources } from './db';
import { getEntitlement } from './limits';
import type { RagContext } from './rag';
import type { IngestContext } from './ingest';
import type { Notebook, Source } from './types';

/** Bindings и променливи на worker-а. Едно и също в dev и в production. */
export { env };

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...(init.headers ?? {}),
    },
  });
}

export function fail(status: number, message: string): Response {
  return json({ error: message }, { status });
}

/** Обвива handler и превръща хвърлените грешки в подредени JSON отговори. */
export function handler(
  fn: (ctx: APIContext) => Promise<Response>,
): (ctx: APIContext) => Promise<Response> {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (err) {
      if (err instanceof HttpError) return fail(err.status, err.message);
      if (err instanceof GeminiError) {
        if (err.status === 401 || err.status === 403) {
          return fail(401, 'Gemini API ключът липсва или е отказан. Провери го в Настройки.');
        }
        if (err.status === 429) {
          return fail(429, 'Достигнат е лимитът на Gemini API. Опитай пак след малко.');
        }
        return fail(502, err.message);
      }
      console.error('[zapiski]', err);
      const message = err instanceof Error ? err.message : 'Неочаквана грешка.';
      return fail(500, message);
    }
  };
}

/**
 * Пуска работа, която да продължи след като отговорът е изпратен.
 * Ползва се за обработката на източници и за аудио прегледа.
 */
export function background(promise: Promise<unknown>): void {
  const guarded = promise.catch((err) => console.error('[zapiski:background]', err));
  try {
    waitUntil(guarded);
  } catch {
    // Извън контекст на заявка (напр. при тест) — просто не чакаме.
    void guarded;
  }
}

export function gemini(ctx: APIContext, model?: string): Gemini {
  const apiKey = ctx.locals.userGeminiKey || env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new HttpError(
      401,
      'Няма Gemini API ключ. Задай GEMINI_API_KEY на сървъра или свой ключ в Настройки.',
    );
  }
  return new Gemini({
    apiKey,
    chatModel: model || env.CHAT_MODEL,
    embedModel: env.EMBED_MODEL,
    ttsModel: env.TTS_MODEL,
    host: env.GEMINI_BASE_URL,
  });
}

export function backendOf(): 'vectorize' | 'gemini' {
  return env.RAG_BACKEND === 'gemini' ? 'gemini' : 'vectorize';
}

/**
 * Чистене на външен ресурс, което няма право да провали заявката.
 * Изтриването на тетрадка трябва да успее дори Vectorize да е недостъпен —
 * останалите вектори са по-малката беда от тетрадка, която не се трие.
 */
export async function bestEffort(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    console.error(`[zapiski:cleanup] ${label}`, err);
  }
}

/** Изтрива вграждания на партиди; Vectorize приема до 1000 наведнъж. */
export async function dropVectors(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += 500) {
    await env.VECTORIZE.deleteByIds(ids.slice(i, i + 500));
  }
}

/** Тетрадка на текущия потребител — или 404. */
export async function requireNotebook(ctx: APIContext, id: string): Promise<Notebook> {
  const nb = await getNotebook(env.DB, ctx.locals.user.id, id);
  if (!nb) throw new HttpError(404, 'Тетрадката не е намерена.');
  return nb;
}

export async function ragContext(
  ctx: APIContext,
  notebook: Notebook,
  model?: string,
): Promise<RagContext> {
  const [settings, entitlement] = await Promise.all([
    getSettings(env.DB, ctx.locals.user.id),
    getEntitlement(env.DB, ctx.locals.user.id),
  ]);
  // Pro моделът е за платените планове; иначе тихо падаме на Flash.
  let chosen = model ?? settings.chatModel;
  if (!entitlement.plan.limits.proModel && chosen.includes('pro')) {
    chosen = 'gemini-2.5-flash';
  }
  return {
    db: env.DB,
    vectorize: env.VECTORIZE,
    gemini: gemini(ctx, chosen),
    backend: backendOf(),
    storeName: notebook.storeName,
    language: settings.responseLanguage || env.RESPONSE_LANGUAGE || 'bg',
  };
}

export function ingestContext(ctx: APIContext, notebook: Notebook): IngestContext {
  return {
    db: env.DB,
    files: env.FILES,
    vectorize: env.VECTORIZE,
    gemini: gemini(ctx),
    backend: backendOf(),
    storeName: notebook.storeName,
  };
}

/** Избраните и вече обработени източници — тези, по които може да се отговаря. */
export async function selectedSources(notebookId: string): Promise<Source[]> {
  const all = await listSources(env.DB, notebookId);
  return all.filter((s) => s.selected && s.status === 'ready');
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Очаквах JSON тяло.');
  }
}
