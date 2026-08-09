/**
 * Redirects `cloudflare:workers` to a local stub so `npx tsx tests/*.mjs` can
 * import application modules that read bindings at module scope.
 *
 *   node --import ./tests/loader.mjs …
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register(pathToFileURL(new URL('./resolve-hook.mjs', import.meta.url).pathname));
