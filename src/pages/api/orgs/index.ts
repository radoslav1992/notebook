import type { APIRoute } from 'astro';
import { env, handler, json, readJson, requireVerified } from '~/lib/api';
import { createOrg, listOrgs } from '~/lib/orgs';

export const prerender = false;

export const GET: APIRoute = handler(async (ctx) =>
  json({ orgs: await listOrgs(env.DB, ctx.locals.user.id) }),
);

/**
 * Създава организация. Иска потвърден имейл по същата причина, по която го иска
 * и тетрадката: организацията е това, което после кани други хора, а покана от
 * непотвърден адрес е спам с наш подател.
 */
export const POST: APIRoute = handler(async (ctx) => {
  requireVerified(ctx);
  const body = await readJson<{ name?: string }>(ctx.request);
  const org = await createOrg(env.DB, ctx.locals.user.id, body.name ?? '');
  return json({ org }, { status: 201 });
});
