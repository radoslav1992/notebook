import type { AstroCookies } from 'astro';
import { appEnv } from './env';
import { newId } from './ids';

/** Structural shape shared by `APIContext` and the `Astro` page global. */
export interface SessionCarrier {
  cookies: AstroCookies;
  url: URL;
}

const COOKIE = 'nblm_owner';
const MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * The app has no login screen — every browser gets a signed, anonymous owner id
 * that scopes its notebooks. Swapping this for real auth means replacing
 * `getOwnerId` with something that reads your identity provider's session.
 */
export async function getOwnerId(context: SessionCarrier): Promise<string> {
  const secret = appEnv().SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'Missing SESSION_SECRET. Put it in `.dev.vars` locally, or run `wrangler secret put SESSION_SECRET` in production.',
    );
  }

  const raw = context.cookies.get(COOKIE)?.value;
  if (raw) {
    const verified = await verify(raw, secret);
    if (verified) return verified;
  }

  const id = newId('u');
  context.cookies.set(COOKIE, await sign(id, secret), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: context.url.protocol === 'https:',
    maxAge: MAX_AGE,
  });
  return id;
}

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sign(id: string, secret: string): Promise<string> {
  return `${id}.${await hmac(id, secret)}`;
}

async function verify(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(id, secret);
  if (sig.length !== expected.length) return null;
  // Constant-time compare.
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? id : null;
}
