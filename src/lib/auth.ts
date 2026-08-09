import { newId, now } from './ids';
import type { User } from './types';

const COOKIE = 'zapiski_sid';
const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Идентичност без регистрация: подписана с HMAC бисквитка носи id на потребител.
 * Дизайнът няма екран за вход, така че всеки браузър получава собствено
 * пространство. Ако по-късно се добави истинско влизане, се сменя само този модул.
 */
async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

function b64url(bytes: ArrayBuffer): string {
  let s = '';
  const view = new Uint8Array(bytes);
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(value: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(value));
  return `${value}.${b64url(sig)}`;
}

async function unsign(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const value = token.slice(0, dot);
  const expected = await sign(value, secret);
  // Постоянно време: сравняваме еднакво дълги низове byte по byte.
  if (expected.length !== token.length) return null;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? value : null;
}

export interface SessionResult {
  user: User;
  /** Присъства, когато на отговора трябва да се сложи нова бисквитка. */
  setCookie?: string;
}

export async function resolveSession(
  request: Request,
  db: D1Database,
  secret: string,
): Promise<SessionResult> {
  const raw = readCookie(request.headers.get('cookie'), COOKIE);
  let userId: string | null = raw ? await unsign(raw, secret) : null;

  if (userId) {
    const row = await db
      .prepare('SELECT id, display_name, initials FROM users WHERE id = ?')
      .bind(userId)
      .first<{ id: string; display_name: string; initials: string }>();
    if (row) {
      return { user: { id: row.id, displayName: row.display_name, initials: row.initials } };
    }
    // Валиден подпис, но липсващ ред (пресъздадена база) — правим нов потребител.
    userId = null;
  }

  const user: User = { id: newId('u'), displayName: 'Радослав', initials: 'РД' };
  const ts = now();
  await db.batch([
    db
      .prepare('INSERT INTO users (id, display_name, initials, created_at) VALUES (?, ?, ?, ?)')
      .bind(user.id, user.displayName, user.initials, ts),
    db
      .prepare('INSERT INTO settings (user_id, updated_at) VALUES (?, ?)')
      .bind(user.id, ts),
  ]);

  const token = await sign(user.id, secret);
  const secure = new URL(request.url).protocol === 'https:';
  const cookie = [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    `Max-Age=${ONE_YEAR}`,
  ].join('; ');

  return { user, setCookie: cookie };
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

/** Инициали от изписано име: „Радослав Дойников“ → „РД“. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ЗП';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}
