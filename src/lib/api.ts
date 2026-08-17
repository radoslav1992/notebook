import { env, waitUntil } from 'cloudflare:workers';
import type { APIContext } from 'astro';
import {
  AiError,
  FALLBACK_EMBED_MODEL,
  FALLBACK_TTS_MODEL,
  buildAi,
  defaultChatModel,
  resolveChatModel,
  type Ai,
} from './ai';
import { HttpError, getNotebook, getSettings, listAllowedSources } from './db';
import { mailer } from './email';
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
      if (err instanceof AiError) {
        // Съобщението е преведено още при доставчика и казва какво да се
        // направи. Тук се избира само статусът, по който интерфейсът различава
        // случаите.
        console.error('[zapiski:ai]', err.status, err.message, err.detail);
        if (err.keyProblem) return fail(401, err.message);
        if (err.status === 429) return fail(429, err.message);
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

/**
 * Трите роли (чат, вграждания, реч), всяка при доставчика, който името на
 * модела посочва. Хвърля, ако избраният модел иска ключ или binding, който го
 * няма — по-добре тук, отколкото след като източникът е записан в базата.
 */
export function ai(ctx: APIContext, model?: string): Ai {
  // trim: ключ, поставен в Cloudflare или в Настройки, често носи нов ред или
  // празно място накрая, а Google отговаря на това с „API key not valid“.
  const googleKey = (ctx.locals.userGeminiKey || env.GEMINI_API_KEY || '').trim();
  return buildAi({
    chatModel: model || defaultChatModel({ chatModel: env.CHAT_MODEL }),
    embedModel: env.EMBED_MODEL || FALLBACK_EMBED_MODEL,
    ttsModel: env.TTS_MODEL || FALLBACK_TTS_MODEL,
    embedDimensions: env.EMBED_DIMENSIONS,
    googleKey: googleKey || undefined,
    googleHost: env.GEMINI_BASE_URL,
    ai: env.AI,
  });
}

/**
 * Непотвърден имейл не харчи квота.
 *
 * Иначе изискването за профил, което сложихме точно за да има кой да отговаря
 * за разхода, се заобикаля с произволен низ с „@“ — потвърждаването беше само
 * украса, защото никъде не се проверяваше.
 *
 * Изключението е важно: ако писма не могат да се пращат (няма нито binding, нито
 * Resend), потвърждаване е невъзможно и изискването би заключило всички,
 * включително локалната работа. Тогава просто минава.
 */
export function requireVerified(ctx: APIContext): void {
  const user = ctx.locals.user;
  if (user.emailVerified) return;
  if (!mailer(env).enabled) return;

  throw new HttpError(
    403,
    `Потвърди имейла си${user.email ? ` (${user.email})` : ''}, за да продължиш. От Настройки може да изпратиш писмото наново.`,
  );
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
  // Pro моделът е за платените планове; иначе тихо падаме на модела по
  // подразбиране на инсталацията — какъвто и да е той, за да не върнем
  // безплатния план към Google, когато проектът е минал на Cloudflare.
  const chosen = resolveChatModel(
    { chatModel: env.CHAT_MODEL, chatModelPro: env.CHAT_MODEL_PRO },
    model ?? settings.chatModel,
    entitlement.plan.limits.proModel,
  );
  return {
    db: env.DB,
    vectorize: env.VECTORIZE,
    ai: ai(ctx, chosen),
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
    ai: ai(ctx),
    backend: backendOf(),
    storeName: notebook.storeName,
  };
}

/**
 * Избраните и вече обработени източници — тези, по които може да се отговаря.
 *
 * Включва и източниците от библиотека на организация, добавени в тетрадката.
 * Минава през `listAllowedSources`, защото там е проверката за членство: това е
 * единственото място, което решава кой източник е разрешен, а извличането само
 * се доверява на резултата.
 */
export async function selectedSources(ctx: APIContext, notebookId: string): Promise<Source[]> {
  const all = await listAllowedSources(env.DB, ctx.locals.user.id, notebookId);
  return all.filter((s) => s.selected && s.status === 'ready');
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Очаквах JSON тяло.');
  }
}
