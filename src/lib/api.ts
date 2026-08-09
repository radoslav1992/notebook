import type { APIContext } from 'astro';
import * as db from './db';
import { ConfigError, getRuntime, type AppContext } from './env';
import { GeminiError } from './gemini';
import { getOwnerId } from './session';
import type { Notebook } from './types';

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  });
}

export function fail(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

/** Thrown to unwind out of a handler with a specific HTTP response. */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface NotebookScope {
  app: AppContext;
  ownerId: string;
  notebook: Notebook;
}

export async function requireNotebook(context: APIContext): Promise<NotebookScope> {
  const app = getRuntime(context);
  const ownerId = await getOwnerId(context);
  const id = context.params.id;
  if (!id) throw new HttpError('Missing notebook id', 400);

  const notebook = await db.getNotebook(app.env.DB, id, ownerId);
  if (!notebook) throw new HttpError('Notebook not found', 404);
  return { app, ownerId, notebook };
}

/** Maps thrown errors onto sensible responses so every route behaves the same. */
export function toResponse(err: unknown): Response {
  if (err instanceof HttpError) return fail(err.message, err.status);
  if (err instanceof ConfigError) return fail(err.message, 500);
  if (err instanceof GeminiError) {
    // Surface quota/permission problems as-is; they are almost always the cause.
    const status = err.status === 429 || err.status === 403 ? err.status : 502;
    return fail(`Gemini API: ${err.message}`, status);
  }
  console.error(err);
  return fail(err instanceof Error ? err.message : 'Unexpected error', 500);
}

/** Wraps a handler so it never leaks a raw exception. */
export function handler(
  fn: (context: APIContext) => Promise<Response>,
): (context: APIContext) => Promise<Response> {
  return async (context) => {
    try {
      return await fn(context);
    } catch (err) {
      return toResponse(err);
    }
  };
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError('Expected a JSON body', 400);
  }
}
