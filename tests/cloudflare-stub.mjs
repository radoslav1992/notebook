/**
 * Stand-in for the `cloudflare:workers` built-in module.
 *
 * Only the two things the app imports: `env` (bindings) and `waitUntil`.
 * Tests that need real bindings drive the app over HTTP instead; this exists so
 * modules importing `env` at the top level can be loaded at all under Node.
 */
export const env = new Proxy(
  {},
  {
    get(_target, prop) {
      if (prop === 'SESSION_SECRET') return 'test-session-secret';
      return undefined;
    },
  },
);

export function waitUntil(promise) {
  // No request lifetime to extend outside Workers; just don't lose rejections.
  void Promise.resolve(promise).catch(() => {});
}

export default { env, waitUntil };
