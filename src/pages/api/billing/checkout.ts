import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { siteUrl } from '~/lib/authApi';
import { HttpError } from '~/lib/db';
import { getEntitlement, saveSubscription } from '~/lib/limits';
import { PAID_PLANS, type BillingInterval, type PlanId, priceIdFor } from '~/lib/plans';
import { Stripe } from '~/lib/stripe';

export const prerender = false;

/** Пуска плащане и връща адреса на Stripe Checkout. */
export const POST: APIRoute = handler(async (ctx) => {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new HttpError(503, 'Плащанията не са настроени на този сървър.');

  const user = ctx.locals.user;
  if (user.isAnonymous || !user.email) {
    throw new HttpError(401, 'Влез в профила си, преди да вземеш план.');
  }

  const body = await readJson<{ plan?: string; interval?: string }>(ctx.request);
  const plan = body.plan as PlanId;
  const interval: BillingInterval = body.interval === 'year' ? 'year' : 'month';
  if (!PAID_PLANS.includes(plan)) throw new HttpError(400, 'Непознат план.');

  const priceId = priceIdFor(env as unknown as Record<string, string | undefined>, plan, interval);
  if (!priceId) {
    throw new HttpError(
      503,
      `Липсва цена за ${plan}/${interval}. Задай STRIPE_PRICE_${plan.toUpperCase()}_${
        interval === 'year' ? 'YEAR' : 'MONTH'
      }.`,
    );
  }

  const stripe = new Stripe({ secretKey, host: env.STRIPE_BASE_URL });
  const current = await getEntitlement(env.DB, user.id);

  // Клиентът в Stripe се прави веднъж и се пази, за да не се дублират картите.
  let customerId = current.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.createCustomer({
      email: user.email,
      name: user.displayName,
      userId: user.id,
    });
    customerId = customer.id;
    await saveSubscription(env.DB, user.id, {
      plan: current.plan.id,
      status: current.status,
      interval: current.interval,
      stripeCustomerId: customerId,
      stripeSubscriptionId: current.stripeSubscriptionId,
      currentPeriodEnd: current.currentPeriodEnd,
      cancelAtPeriodEnd: current.cancelAtPeriodEnd,
    });
  }

  const site = siteUrl(ctx.request);
  const session = await stripe.createCheckoutSession({
    customerId,
    priceId,
    userId: user.id,
    successUrl: `${site}/app/settings?checkout=success`,
    cancelUrl: `${site}/pricing?checkout=cancel`,
    trialDays: env.STRIPE_TRIAL_DAYS ? Number(env.STRIPE_TRIAL_DAYS) : undefined,
  });

  return json({ url: session.url });
});
