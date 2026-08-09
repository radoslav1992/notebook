import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import { consumeEmailToken, markEmailVerified, startSession } from '~/lib/auth';
import { sendVerification, sessionSecret } from '~/lib/authApi';
import { HttpError } from '~/lib/db';

export const prerender = false;

/** Потвърждава имейла по еднократна връзка и влиза в профила. */
export const POST: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ token?: string }>(ctx.request);
  const token = body.token?.trim();
  if (!token) throw new HttpError(400, 'Липсва връзката за потвърждаване.');

  const claim = await consumeEmailToken(env.DB, token, 'verify');
  if (!claim) {
    throw new HttpError(400, 'Връзката е изтекла или вече е използвана.');
  }

  await markEmailVerified(env.DB, claim.userId);
  const { cookie } = await startSession(ctx.request, env.DB, sessionSecret(), claim.userId);
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
});

/** Праща наново писмото за потвърждаване. */
export const PATCH: APIRoute = handler(async (ctx) => {
  const user = ctx.locals.user;
  if (user.isAnonymous || !user.email) {
    throw new HttpError(401, 'Влез в профила си, за да поискаш ново писмо.');
  }
  if (user.emailVerified) return json({ ok: true, alreadyVerified: true });

  const { sent, link } = await sendVerification(ctx.request, env.DB, user.id, user.email);
  return json({ ok: true, emailSent: sent, verifyLink: sent ? undefined : link });
});
