import type { APIRoute } from 'astro';
import { env, handler, json, readJson } from '~/lib/api';
import {
  consumeEmailToken,
  endAllSessions,
  hashPassword,
  markEmailVerified,
  setPassword,
  startSession,
} from '~/lib/auth';
import { sessionSecret } from '~/lib/authApi';
import { HttpError } from '~/lib/db';
import { passwordProblem } from '~/lib/auth';

export const prerender = false;

/**
 * Задава нова парола по еднократна връзка.
 *
 * Всички други сесии падат: ако някой е бил влязъл с открадната парола,
 * смяната го изхвърля. Успешното ползване на връзката потвърждава и имейла —
 * човекът явно чете писмата на този адрес.
 */
export const POST: APIRoute = handler(async (ctx) => {
  const body = await readJson<{ token?: string; password?: string }>(ctx.request);
  const token = body.token?.trim();
  const password = body.password ?? '';
  if (!token) throw new HttpError(400, 'Липсва връзката за смяна на паролата.');

  const problem = passwordProblem(password);
  if (problem) throw new HttpError(400, problem);

  const claim = await consumeEmailToken(env.DB, token, 'reset');
  if (!claim) {
    throw new HttpError(400, 'Връзката е изтекла или вече е използвана. Поискай нова.');
  }

  await setPassword(env.DB, claim.userId, await hashPassword(password));
  await markEmailVerified(env.DB, claim.userId);
  await endAllSessions(env.DB, claim.userId);

  const { cookie } = await startSession(ctx.request, env.DB, sessionSecret(), claim.userId);
  return json({ ok: true }, { headers: { 'set-cookie': cookie } });
});
