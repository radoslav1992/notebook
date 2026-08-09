/**
 * Google OAuth 2.0, authorization code flow.
 *
 * Кодът се обменя от сървър към сървър по TLS, затова `id_token` не се проверява
 * с подпис — идва директно от token endpoint-а на Google, а не през браузъра.
 */

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
}

export function googleAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  /** Показва избор на профил вместо мълчаливо влизане с последния. */
  prompt?: 'select_account' | 'consent' | 'none';
  loginHint?: string;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: input.state,
    access_type: 'online',
    include_granted_scopes: 'true',
    prompt: input.prompt ?? 'select_account',
  });
  if (input.loginHint) params.set('login_hint', input.loginHint);
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeGoogleCode(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<GoogleProfile> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Google отказа обмяната на кода (${res.status}): ${detail.slice(0, 200)}`);
  }

  const body = (await res.json()) as { id_token?: string };
  if (!body.id_token) throw new Error('Google не върна id_token.');

  const claims = decodeJwtPayload(body.id_token);
  const sub = typeof claims.sub === 'string' ? claims.sub : '';
  const email = typeof claims.email === 'string' ? claims.email : '';
  if (!sub || !email) throw new Error('Google не върна имейл за този профил.');

  return {
    sub,
    email,
    emailVerified: claims.email_verified === true || claims.email_verified === 'true',
    name: typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : '',
  };
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) throw new Error('id_token е с неочакван вид.');
  const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
  const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  // atob дава байтове; имената идват в UTF-8.
  const bytes = new Uint8Array(json.length);
  for (let i = 0; i < json.length; i++) bytes[i] = json.charCodeAt(i);
  return JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
}
