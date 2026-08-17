import type { APIRoute } from 'astro';
import { env, handler, json } from '~/lib/api';
import { HttpError } from '~/lib/db';
import { listOrgs } from '~/lib/orgs';

export const prerender = false;

/**
 * Членовете на организацията. Вижда ги всеки член — кой е в общата библиотека не
 * е тайна от хората, които я ползват, а без списък никой не разбира, че е
 * останал сам, докато не се опита да си изтрие профила.
 */
export const GET: APIRoute = handler(async (ctx) => {
  const orgId = ctx.params.id!;
  const mine = await listOrgs(env.DB, ctx.locals.user.id);
  if (!mine.some((o) => o.id === orgId)) {
    throw new HttpError(404, 'Организацията не е намерена.');
  }

  const { results } = await env.DB
    .prepare(
      `SELECT u.id, u.email, u.display_name, m.role, m.created_at
       FROM org_members m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, m.created_at`,
    )
    .bind(orgId)
    .all<{ id: string; email: string | null; display_name: string; role: string; created_at: number }>();

  return json({
    members: (results ?? []).map((r) => ({
      id: r.id,
      email: r.email,
      name: r.display_name,
      role: r.role,
      you: r.id === ctx.locals.user.id,
    })),
  });
});
