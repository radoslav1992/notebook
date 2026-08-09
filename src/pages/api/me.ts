import type { APIRoute } from 'astro';
import { env, handler, json } from '~/lib/api';
import { getSettings } from '~/lib/db';
import { getEntitlement, getUsage } from '~/lib/limits';
import { PLANS } from '~/lib/plans';

export const prerender = false;

/** Всичко, което интерфейсът трябва да знае за текущия човек. */
export const GET: APIRoute = handler(async (ctx) => {
  const user = ctx.locals.user;
  const [settings, entitlement, usage] = await Promise.all([
    getSettings(env.DB, user.id),
    getEntitlement(env.DB, user.id),
    getUsage(env.DB, user.id),
  ]);

  return json({
    user,
    settings,
    subscription: {
      plan: entitlement.plan.id,
      planName: entitlement.plan.name,
      status: entitlement.status,
      interval: entitlement.interval,
      currentPeriodEnd: entitlement.currentPeriodEnd,
      cancelAtPeriodEnd: entitlement.cancelAtPeriodEnd,
      hasStripeCustomer: Boolean(entitlement.stripeCustomerId),
      limits: {
        ...entitlement.plan.limits,
        // JSON не носи Infinity; интерфейсът показва „неограничено“ при null.
        notebooks: Number.isFinite(entitlement.plan.limits.notebooks)
          ? entitlement.plan.limits.notebooks
          : null,
      },
    },
    usage,
    billingEnabled: Boolean(env.STRIPE_SECRET_KEY),
    googleEnabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    emailEnabled: Boolean(env.RESEND_API_KEY),
    plans: Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      monthly: p.monthly,
      yearly: p.yearly,
    })),
  });
});
