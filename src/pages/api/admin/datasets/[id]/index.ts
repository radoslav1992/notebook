import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { grantDataset, publishDataset, requireAdmin, updateDatasetMeta } from '~/lib/datasets';
import { findUserByEmail } from '~/lib/auth';
import { HttpError } from '~/lib/db';
import { USE_CASES } from '~/lib/prompts';

export const prerender = false;

export const PATCH: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  const id = ctx.params.id!;
  const body = await readJson<{
    blurb?: string;
    useCases?: string[];
    published?: boolean;
    grantTo?: string;
  }>(ctx.request);

  if (body.blurb !== undefined || body.useCases !== undefined) {
    const known = new Set(USE_CASES.map((u) => u.value));
    await updateDatasetMeta(env.DB, id, {
      blurb: body.blurb,
      useCases: body.useCases?.filter((u) => known.has(u as never)),
    });
  }

  if (typeof body.published === 'boolean') {
    await publishDataset(env.DB, id, body.published);
  }

  // Даването на достъп е тук, докато няма плащане. После същата функция ще се
  // вика от webhook-а — затова живее в `datasets.ts`, не в този маршрут.
  if (body.grantTo) {
    const user = await findUserByEmail(env.DB, body.grantTo);
    if (!user) throw new HttpError(404, `Няма профил с имейл ${body.grantTo}.`);
    await grantDataset(env.DB, user.id, id);
  }

  return json({ ok: true });
});
