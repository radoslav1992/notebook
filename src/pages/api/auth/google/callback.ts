import type { APIRoute } from 'astro';
import { env } from '~/lib/api';
import {
  claimAnonymous,
  createUser,
  findUserByEmail,
  findUserByGoogleId,
  linkGoogle,
  nameFromEmail,
  normalizeEmail,
  startSession,
  upgradeAnonymous,
} from '~/lib/auth';
import { OAUTH_STATE_COOKIE, safeNext, sessionSecret, siteUrl, stateCookie } from '~/lib/authApi';
import { exchangeGoogleCode } from '~/lib/oauth';

export const prerender = false;

/**
 * Връщане от Google.
 *
 * Отговорът е пренасочване, не JSON — това е навигация в браузъра. Грешките
 * стигат до /login като текст, вместо да оставят бял екран.
 */
export const GET: APIRoute = async (ctx) => {
  const back = (path: string, extra: Record<string, string> = {}) => {
    const url = new URL(path, siteUrl(ctx.request));
    for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
    return new Response(null, {
      status: 302,
      headers: {
        location: url.toString(),
        // Еднократната бисквитка си отива с нея.
        'set-cookie': stateCookie(ctx.url.protocol === 'https:', '', 0),
        'cache-control': 'no-store',
      },
    });
  };

  try {
    const params = ctx.url.searchParams;
    if (params.get('error')) {
      return back('/login', { error: 'Влизането с Google беше отказано.' });
    }

    const code = params.get('code');
    const state = params.get('state') ?? '';
    const [nonce, encodedNext] = state.split(':');
    const next = safeNext(encodedNext ? decodeURIComponent(encodedNext) : null);

    const cookieNonce = readCookie(ctx.request.headers.get('cookie'), OAUTH_STATE_COOKIE);
    if (!code || !nonce || !cookieNonce || nonce !== cookieNonce) {
      return back('/login', { error: 'Влизането изтече. Опитай пак.' });
    }
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      return back('/login', { error: 'Влизането с Google не е настроено.' });
    }

    const profile = await exchangeGoogleCode({
      code,
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: `${siteUrl(ctx.request)}/api/auth/google/callback`,
    });

    if (!profile.emailVerified) {
      return back('/login', { error: 'Google казва, че този имейл не е потвърден.' });
    }

    const email = normalizeEmail(profile.email);
    const guest = ctx.locals.user;
    let userId: string;
    let claimed = 0;

    const byGoogle = await findUserByGoogleId(env.DB, profile.sub);
    const byEmail = byGoogle ? null : await findUserByEmail(env.DB, email);

    if (byGoogle) {
      userId = byGoogle.id;
    } else if (byEmail) {
      // Профил с парола на същия адрес — свързваме двата начина за влизане.
      userId = byEmail.id;
      await linkGoogle(env.DB, userId, profile.sub);
    } else if (guest.id && guest.isAnonymous) {
      // Гостът става истински профил и си запазва тетрадките.
      userId = guest.id;
      await upgradeAnonymous(env.DB, userId, {
        email,
        displayName: profile.name || nameFromEmail(email),
        googleId: profile.sub,
        emailVerified: true,
      });
    } else if (guest.id) {
      // Влязъл с парола — свързваме Google към същия профил.
      userId = guest.id;
      await linkGoogle(env.DB, userId, profile.sub);
    } else {
      const created = await createUser(env.DB, {
        email,
        displayName: profile.name || nameFromEmail(email),
        googleId: profile.sub,
        emailVerified: true,
      });
      userId = created.id;
    }

    if (guest.id && guest.isAnonymous && guest.id !== userId) {
      claimed = await claimAnonymous(env.DB, guest.id, userId);
    }

    const { cookie } = await startSession(ctx.request, env.DB, sessionSecret(), userId);
    const target = new URL(next, siteUrl(ctx.request));
    if (claimed > 0) target.searchParams.set('claimed', String(claimed));

    const headers = new Headers({ location: target.toString(), 'cache-control': 'no-store' });
    headers.append('set-cookie', cookie);
    headers.append('set-cookie', stateCookie(ctx.url.protocol === 'https:', '', 0));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error('[zapiski:google]', err);
    return back('/login', { error: 'Влизането с Google не успя. Опитай пак.' });
  }
};

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}
