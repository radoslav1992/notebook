import type { APIRoute } from 'astro';
import { env } from '~/lib/api';
import { findUserByCustomerId, markEventProcessed, saveSubscription } from '~/lib/limits';
import { planFromPriceId } from '~/lib/plans';
import {
  Stripe,
  type StripeCheckoutSession,
  type StripeSubscription,
  intervalOf,
  periodEndMs,
  priceIdOf,
} from '~/lib/stripe';

export const prerender = false;

/**
 * Единственият източник на истина за платените планове.
 *
 * Не се доверяваме на връщането от Checkout: браузърът може и да не стигне до
 * success_url. Планът се вписва тук, след като подписът е проверен.
 *
 * Отговаряме 200 и на неща, които не разбираме — иначе Stripe започва да
 * повтаря завинаги. Истинските грешки връщат 500, за да има повторен опит.
 */
export const POST: APIRoute = async (ctx) => {
  const secret = env.STRIPE_WEBHOOK_SECRET;
  const secretKey = env.STRIPE_SECRET_KEY;
  if (!secret || !secretKey) {
    return new Response('Плащанията не са настроени.', { status: 503 });
  }

  const payload = await ctx.request.text();

  let event;
  try {
    event = await Stripe.verifyWebhook({
      payload,
      signatureHeader: ctx.request.headers.get('stripe-signature'),
      secret,
    });
  } catch (err) {
    console.error('[zapiski:stripe] подписът не мина', err);
    return new Response('Невалиден подпис.', { status: 400 });
  }

  // Stripe праща едно събитие по няколко пъти; второто минаване е без ефект.
  const fresh = await markEventProcessed(env.DB, event.id, event.type);
  if (!fresh) return new Response('ok (вече обработено)', { status: 200 });

  const stripe = new Stripe({ secretKey, host: env.STRIPE_BASE_URL });

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as unknown as StripeCheckoutSession;
        if (!session.subscription) break;
        const sub = await stripe.getSubscription(session.subscription);
        const userId =
          session.client_reference_id ??
          session.metadata?.userId ??
          sub.metadata?.userId ??
          (typeof session.customer === 'string'
            ? await findUserByCustomerId(env.DB, session.customer)
            : null);
        await apply(userId, sub);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as unknown as StripeSubscription;
        const userId =
          sub.metadata?.userId ??
          (typeof sub.customer === 'string'
            ? await findUserByCustomerId(env.DB, sub.customer)
            : null);
        await apply(userId, sub, event.type === 'customer.subscription.deleted');
        break;
      }

      default:
        // Не ни касае — но е обработено, за да не се повтаря.
        break;
    }
  } catch (err) {
    console.error(`[zapiski:stripe] ${event.type} се провали`, err);
    // Махаме отпечатъка, за да има смисъл повторният опит на Stripe.
    await env.DB.prepare('DELETE FROM stripe_events WHERE id = ?').bind(event.id).run();
    return new Response('Обработката се провали.', { status: 500 });
  }

  return new Response('ok', { status: 200 });
};

/** Вписва абонамента срещу нашия потребител. */
async function apply(
  userId: string | null | undefined,
  sub: StripeSubscription,
  removed = false,
): Promise<void> {
  if (!userId) {
    console.error('[zapiski:stripe] абонамент без разпознат потребител', sub.id);
    return;
  }

  const priceId = priceIdOf(sub);
  const matched = priceId
    ? planFromPriceId(env as unknown as Record<string, string | undefined>, priceId)
    : null;

  if (!matched) {
    console.error('[zapiski:stripe] непознато price ID', priceId);
  }

  const canceled = removed || sub.status === 'canceled' || sub.status === 'incomplete_expired';

  await saveSubscription(env.DB, userId, {
    plan: canceled ? 'free' : (matched?.plan ?? 'free'),
    status: canceled ? 'canceled' : sub.status,
    interval: matched?.interval ?? intervalOf(sub),
    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : null,
    stripeSubscriptionId: canceled ? null : sub.id,
    currentPeriodEnd: periodEndMs(sub),
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  });
}
