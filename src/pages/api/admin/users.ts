import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { findUserByEmail } from '~/lib/auth';
import { requireAdmin } from '~/lib/datasets';
import { HttpError } from '~/lib/db';
import { adminSetPlan, getEntitlement, getUsage } from '~/lib/limits';
import { PLANS, type PlanId } from '~/lib/plans';

export const prerender = false;

/**
 * Ръчното управление на планове — за сделки по фактура и жестове.
 * Търси се по имейл, защото това е, което админът знае за човека.
 */

async function lookup(email: string) {
  const user = await findUserByEmail(env.DB, email);
  if (!user) throw new HttpError(404, 'Няма профил с този имейл.');
  const [ent, usage] = await Promise.all([
    getEntitlement(env.DB, user.id),
    getUsage(env.DB, user.id),
  ]);
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    plan: ent.plan.id,
    stripeManaged: Boolean(ent.stripeSubscriptionId),
    questions: usage.questions,
    notebooks: usage.notebooks,
  };
}

export const GET: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  const email = new URL(ctx.request.url).searchParams.get('email')?.trim() ?? '';
  if (!email) throw new HttpError(400, 'Подай имейл.');
  return json({ user: await lookup(email) });
});

export const PATCH: APIRoute = handler(async (ctx) => {
  requireAdmin(env, ctx.locals.user.email);
  const body = await readJson<{ email?: string; plan?: string }>(ctx.request);
  const email = body.email?.trim() ?? '';
  const plan = body.plan ?? '';
  if (!email) throw new HttpError(400, 'Подай имейл.');
  if (!(plan in PLANS)) throw new HttpError(400, 'Непознат план.');

  const user = await findUserByEmail(env.DB, email);
  if (!user) throw new HttpError(404, 'Няма профил с този имейл.');
  await adminSetPlan(env.DB, user.id, plan as PlanId);
  return json({ user: await lookup(email) });
});
