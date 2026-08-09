import { env as workerEnv } from 'cloudflare:workers';
import type { GeminiConfig } from './gemini';

/** Structural shape shared by `APIContext` and the `Astro` page global. */
export interface RuntimeCarrier {
  locals: App.Locals;
}

export interface AppEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
  GEMINI_API_KEY: string;
  SESSION_SECRET: string;
  GEMINI_CHAT_MODEL?: string;
  GEMINI_TTS_MODEL?: string;
}

export interface AppContext {
  env: AppEnv;
  ctx: ExecutionContext;
  gemini: GeminiConfig;
}

export class ConfigError extends Error {}

/**
 * Bindings come from the `cloudflare:workers` module (Astro 6 removed
 * `locals.runtime.env`); the execution context still rides on `locals`.
 */
export function appEnv(): AppEnv {
  const env = workerEnv as unknown as AppEnv;
  if (!env?.DB) throw new ConfigError('Missing D1 binding `DB`. Add it to wrangler.jsonc.');
  if (!env.MEDIA) throw new ConfigError('Missing R2 binding `MEDIA`. Add it to wrangler.jsonc.');
  return env;
}

export function getRuntime(context: RuntimeCarrier): AppContext {
  const env = appEnv();

  if (!env.GEMINI_API_KEY) {
    throw new ConfigError(
      'Missing GEMINI_API_KEY. Put it in `.dev.vars` locally, or run `wrangler secret put GEMINI_API_KEY` in production.',
    );
  }

  const ctx = context.locals.cfContext;
  if (!ctx) {
    throw new ConfigError(
      'Cloudflare execution context is unavailable. Run through `astro dev` or `wrangler dev`.',
    );
  }

  return {
    env,
    ctx,
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      chatModel: env.GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
      ttsModel: env.GEMINI_TTS_MODEL || 'gemini-2.5-flash-preview-tts',
    },
  };
}
