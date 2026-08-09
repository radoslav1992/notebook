import type { APIRoute } from 'astro';
import { env, handler, json } from '~/lib/api';
import { clearCookieHeader, endSession } from '~/lib/auth';
import { sessionSecret } from '~/lib/authApi';

export const prerender = false;

export const POST: APIRoute = handler(async (ctx) => {
  await endSession(ctx.request, env.DB, sessionSecret());
  return json({ ok: true }, { headers: { 'set-cookie': clearCookieHeader(ctx.request) } });
});
