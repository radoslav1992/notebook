import type { APIRoute } from 'astro';
import { env, handler } from '~/lib/api';
import { exportUserData } from '~/lib/db';

export const prerender = false;

/**
 * Правото на преносимост по GDPR: всичко, което човекът е създал, в един файл.
 *
 * Сваля се като прикачен файл, а не се показва в раздела — иначе браузърът
 * държи цялата история на разговорите в паметта без причина.
 */
export const GET: APIRoute = handler(async (ctx) => {
  const data = await exportUserData(env.DB, ctx.locals.user.id);
  const stamp = new Date().toISOString().slice(0, 10);

  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="zapiski-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
});
