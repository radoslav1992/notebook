const STUBS = {
  'cloudflare:workers': new URL('./cloudflare-stub.mjs', import.meta.url).href,
  'astro:middleware': new URL('./astro-middleware-stub.mjs', import.meta.url).href,
};

export function resolve(specifier, context, next) {
  const stub = STUBS[specifier];
  if (stub) return { url: stub, shortCircuit: true };
  return next(specifier, context);
}
