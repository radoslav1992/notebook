import type { APIRoute } from 'astro';
import { ai, backendOf, bestEffort, dropVectors, env, handler, json, readJson } from '~/lib/api';
import { collectUserFootprint, deleteUserRows, getSettings, HttpError } from '~/lib/db';
import { getEntitlement, getUsage } from '~/lib/limits';
import { PLANS } from '~/lib/plans';
import { clearCookieHeader, getPasswordHash, verifyPassword } from '~/lib/auth';
import { Stripe } from '~/lib/stripe';
import { releaseOrgsOfUser } from '~/lib/orgs';
import { countOwnedDatasets } from '~/lib/datasets';
import { mailer } from '~/lib/email';

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
    // Не е само Resend вече: с binding-а на Cloudflare писмата тръгват без ключ.
    emailEnabled: mailer(env).enabled,
    plans: Object.values(PLANS).map((p) => ({
      id: p.id,
      name: p.name,
      monthly: p.monthly,
      yearly: p.yearly,
    })),
  });
});

/**
 * Правото на изтриване по GDPR.
 *
 * Редът е важен и не е очевиден:
 *
 *  1. **Стоп на абонамента** — иначе Stripe продължава да таксува карта, за
 *     която вече няма профил. Прави се ПРЕДИ триенето, докато още знаем кой е
 *     абонаментът.
 *  2. **Опис на следите** — кои вектори, кои файлове. След като редовете ги
 *     няма, няма как да се разбере кои са били негови и остават достъпни.
 *  3. **Редовете в D1.**
 *  4. **Външните неща** — Vectorize, R2, File Search. „Best effort“: ако
 *     Vectorize е недостъпен, профилът пак трябва да изчезне, а остатъкът се
 *     вижда в лога.
 */
export const DELETE: APIRoute = handler(async (ctx) => {
  const user = ctx.locals.user;
  const body = await readJson<{ password?: string; confirm?: string }>(ctx.request).catch(
    () => ({}) as { password?: string; confirm?: string },
  );

  // Който има парола, я въвежда: изтриването е необратимо и една открадната
  // отворена сесия не бива да стига. Профилите само с Google потвърждават с
  // изписване на думата.
  const hash = await getPasswordHash(env.DB, user.id);
  if (hash) {
    if (!body.password || !(await verifyPassword(body.password, hash))) {
      throw new HttpError(401, 'Паролата не съвпада.');
    }
  } else if ((body.confirm ?? '').trim().toUpperCase() !== 'ИЗТРИЙ') {
    throw new HttpError(400, 'Напиши ИЗТРИЙ, за да потвърдиш.');
  }

  const entitlement = await getEntitlement(env.DB, user.id);
  if (entitlement.stripeSubscriptionId && env.STRIPE_SECRET_KEY) {
    await bestEffort('stripe cancel', () =>
      new Stripe({ secretKey: env.STRIPE_SECRET_KEY!, host: env.STRIPE_BASE_URL }).cancelSubscription(
        entitlement.stripeSubscriptionId!,
      ),
    );
  }

  // Наборите нямат наследник като библиотеките на организация — те са на
  // платформата, но носят `user_id` на създателя си. Изтриването би ги отнесло
  // за ВСИЧКИ потребители, затова се отказва, докато има такива.
  const ownedDatasets = await countOwnedDatasets(env.DB, user.id);
  if (ownedDatasets > 0) {
    throw new HttpError(
      409,
      `Профилът ти е собственик на ${ownedDatasets} ${ownedDatasets === 1 ? 'общ набор' : 'общи набора'}. Изтрий ги от административния панел, преди да изтриеш профила — иначе изчезват за всички.`,
    );
  }

  // Преди триенето: библиотеката носи `user_id` на създателя си, тоест иначе си
  // отива с него и организацията остава без общите източници, макар останалите
  // членове да не са направили нищо.
  await releaseOrgsOfUser(env.DB, user.id);

  const footprint = await collectUserFootprint(env.DB, user.id);
  await deleteUserRows(env.DB, user.id);

  if (footprint.chunkIds.length > 0) {
    await bestEffort('vectorize', () => dropVectors(footprint.chunkIds));
  }
  if (footprint.r2Keys.length > 0) {
    await bestEffort('r2 sources', () => env.FILES.delete(footprint.r2Keys));
  }
  for (const notebookId of footprint.notebookIds) {
    await bestEffort('r2 audio', async () => {
      const listed = await env.FILES.list({ prefix: `audio/${notebookId}/` });
      if (listed.objects.length > 0) {
        await env.FILES.delete(listed.objects.map((o) => o.key));
      }
    });
  }
  if (backendOf() === 'gemini' && footprint.storeNames.length > 0) {
    const google = ai(ctx).google;
    if (google) {
      for (const storeName of footprint.storeNames) {
        await bestEffort('file search store', () => google.deleteFileSearchStore(storeName));
      }
    }
  }

  console.warn('[zapiski:gdpr] изтрит профил', {
    userId: user.id,
    notebooks: footprint.notebookIds.length,
    chunks: footprint.chunkIds.length,
    files: footprint.r2Keys.length,
  });

  // Бисквитката се маха изрично: сесиите вече ги няма в базата, но браузърът
  // не знае това и би пращал мъртъв токен при всяка заявка.
  return json({ ok: true }, { headers: { 'set-cookie': clearCookieHeader(ctx.request) } });
});
