import type { APIRoute } from 'astro';
import { env, handler, json } from '~/lib/api';
import { siteUrl } from '~/lib/authApi';
import { HttpError } from '~/lib/db';
import { getEntitlement } from '~/lib/limits';
import { Stripe } from '~/lib/stripe';

export const prerender = false;

/**
 * Отваря Stripe Billing Portal. Оттам човек сменя картата си, тегли фактури и
 * спира абонамента — не пишем свои екрани за неща, които Stripe вече прави.
 */
export const POST: APIRoute = handler(async (ctx) => {
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secretKey) throw new HttpError(503, 'Плащанията не са настроени на този сървър.');

  const user = ctx.locals.user;
  if (user.isAnonymous) throw new HttpError(401, 'Влез в профила си.');

  const current = await getEntitlement(env.DB, user.id);
  if (!current.stripeCustomerId) {
    throw new HttpError(400, 'Още няма плащане към този профил.');
  }

  const stripe = new Stripe({ secretKey, host: env.STRIPE_BASE_URL });
  const session = await stripe.createPortalSession({
    customerId: current.stripeCustomerId,
    returnUrl: `${siteUrl(ctx.request)}/app/settings`,
  });

  return json({ url: session.url });
});
