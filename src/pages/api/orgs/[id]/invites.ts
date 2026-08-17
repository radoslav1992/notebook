import type { APIRoute } from 'astro';
import { env, handler, json, readJson, requireVerified } from '~/lib/api';
import { HttpError, type OrgRole } from '~/lib/db';
import { inviteToOrg, listOrgs } from '~/lib/orgs';
import { inviteEmail, mailer } from '~/lib/email';
import { siteUrl } from '~/lib/authApi';

export const prerender = false;

/**
 * Кани човек в организацията. Само собственик или администратор.
 *
 * Връзката се връща в отговора, а не само се праща: без настроен доставчик на
 * писма поканите иначе стават невъзможни, а това заключва цялата функция в
 * инсталация, която още няма домейн.
 */
export const POST: APIRoute = handler(async (ctx) => {
  requireVerified(ctx);
  const orgId = ctx.params.id!;
  const body = await readJson<{ email?: string; role?: OrgRole }>(ctx.request);

  const mine = await listOrgs(env.DB, ctx.locals.user.id);
  const org = mine.find((o) => o.id === orgId);
  if (!org) throw new HttpError(404, 'Организацията не е намерена.');
  if (org.role === 'member') {
    throw new HttpError(403, 'Само собственик или администратор може да кани.');
  }

  const invite = await inviteToOrg(env.DB, {
    orgId,
    invitedBy: ctx.locals.user.id,
    email: body.email ?? '',
    role: body.role === 'admin' ? 'admin' : 'member',
  });

  const link = `${siteUrl(ctx.request)}/join?token=${invite.token}`;
  const post = mailer(env);
  await post.send({
    to: invite.email,
    ...inviteEmail({ orgName: org.name, invitedBy: ctx.locals.user.email ?? '', link }),
  });

  return json({ email: invite.email, role: invite.role, emailSent: post.enabled, link });
});
