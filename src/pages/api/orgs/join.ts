import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { acceptInvite } from '~/lib/orgs';

export const prerender = false;

export const POST: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ token?: string }>(ctx.request);
  const user = ctx.locals.user;
  const org = await acceptInvite(env.DB, { id: user.id, email: user.email }, body.token ?? '');
  return json({ org });
});
