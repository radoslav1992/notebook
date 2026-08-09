/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />

// Secrets are supplied via `.dev.vars` / `wrangler secret put`, so they are not
// part of the bindings `wrangler types` derives from wrangler.jsonc.
interface Env {
  GEMINI_API_KEY: string;
  SESSION_SECRET: string;
}
