import { newId, now } from './ids';
import type { User } from './types';

const COOKIE = 'zapiski_sid';
const SESSION_DAYS = 60;
const VERIFY_HOURS = 48;
const RESET_HOURS = 2;

/** PBKDF2-SHA256 през WebCrypto — Workers няма native bcrypt/argon2. */
const PBKDF2_ITERATIONS = 210_000;

/* ── Бисквитка и подпис ──────────────────────────────────────────────────── */

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (const b of view) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sign(value: string, secret: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(value));
  return `${value}.${b64url(sig)}`;
}

async function unsign(token: string, secret: string): Promise<string | null> {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const expected = await sign(token.slice(0, dot), secret);
  if (expected.length !== token.length) return null;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0 ? token.slice(0, dot) : null;
}

export async function sha256(text: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64url(buf);
}

function cookieHeader(request: Request, token: string, maxAgeSeconds: number): string {
  const secure = new URL(request.url).protocol === 'https:';
  return [
    `${COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

export function clearCookieHeader(request: Request): string {
  const secure = new URL(request.url).protocol === 'https:';
  return [
    `${COOKIE}=`,
    'Path=/',
    'HttpOnly',
    ...(secure ? ['Secure'] : []),
    'SameSite=Lax',
    'Max-Age=0',
  ].join('; ');
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

/* ── Пароли ──────────────────────────────────────────────────────────────── */

/** `pbkdf2$sha256$<итерации>$<сол>$<хеш>` — форматът носи параметрите си, за да
 *  може броят итерации да се вдигне по-късно без да чупи старите пароли. */
export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 1000) return false;
  const salt = fromB64url(parts[3]!);
  const expected = parts[4]!;
  const actual = b64url(await pbkdf2(password, salt, iterations));
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  );
}

function fromB64url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* ── Сесии ───────────────────────────────────────────────────────────────── */

interface UserRow {
  id: string;
  display_name: string;
  initials: string;
  email: string | null;
  email_verified: number;
  is_anonymous: number;
  password_hash: string | null;
  google_id: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    displayName: row.display_name,
    initials: row.initials,
    email: row.email,
    emailVerified: row.email_verified === 1,
    isAnonymous: row.is_anonymous === 1,
    hasPassword: Boolean(row.password_hash),
    hasGoogle: Boolean(row.google_id),
  };
}

const USER_FIELDS = [
  'id',
  'display_name',
  'initials',
  'email',
  'email_verified',
  'is_anonymous',
  'password_hash',
  'google_id',
] as const;

const USER_COLUMNS = USER_FIELDS.join(', ');
const USER_COLUMNS_JOINED = USER_FIELDS.map((f) => `u.${f}`).join(', ');

export interface SessionResult {
  user: User;
  setCookie?: string;
}

/**
 * Намира потребителя по сесийната бисквитка. Ако няма валидна сесия, прави
 * анонимен профил — приложението се пробва без регистрация, а тетрадките се
 * прибират при първото влизане (`claimAnonymous`).
 */
export async function resolveSession(
  request: Request,
  db: D1Database,
  secret: string,
): Promise<SessionResult> {
  const raw = readCookie(request.headers.get('cookie'), COOKIE);
  const token = raw ? await unsign(raw, secret) : null;

  if (token) {
    const hash = await sha256(token);
    const row = await db
      .prepare(
        `SELECT ${USER_COLUMNS_JOINED}, s.expires_at
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .bind(hash)
      .first<UserRow & { expires_at: number }>();

    if (row && row.expires_at > now()) {
      return { user: toUser(row) };
    }
    if (row) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(hash).run();
    }
  }

  const user = await createAnonymousUser(db);
  const { cookie } = await startSession(request, db, secret, user.id);
  return { user, setCookie: cookie };
}

/**
 * Чете сесията, ако има валидна, но никога не създава профил.
 * За публични страници (цените), където не искаме всеки минаващ робот да
 * оставя ред в базата.
 */
export async function peekSession(
  request: Request,
  db: D1Database,
  secret: string,
): Promise<User | null> {
  const raw = readCookie(request.headers.get('cookie'), COOKIE);
  const token = raw ? await unsign(raw, secret) : null;
  if (!token) return null;

  const row = await db
    .prepare(
      `SELECT ${USER_COLUMNS_JOINED}, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .bind(await sha256(token))
    .first<UserRow & { expires_at: number }>();

  if (!row || row.expires_at <= now()) return null;
  return toUser(row);
}

export async function createAnonymousUser(db: D1Database): Promise<User> {
  const id = newId('u');
  const ts = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, display_name, initials, created_at, is_anonymous, email_verified)
         VALUES (?, 'Гост', 'ГО', ?, 1, 0)`,
      )
      .bind(id, ts),
    db.prepare('INSERT INTO settings (user_id, updated_at) VALUES (?, ?)').bind(id, ts),
  ]);
  return {
    id,
    displayName: 'Гост',
    initials: 'ГО',
    email: null,
    emailVerified: false,
    isAnonymous: true,
    hasPassword: false,
    hasGoogle: false,
  };
}

/** Създава истински профил направо — когато регистрацията идва без сесия. */
export async function createUser(
  db: D1Database,
  input: {
    email: string;
    displayName: string;
    passwordHash?: string | null;
    googleId?: string | null;
    emailVerified: boolean;
  },
): Promise<User> {
  const id = newId('u');
  const ts = now();
  const email = normalizeEmail(input.email);
  const initials = initialsOf(input.displayName);
  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, display_name, initials, created_at, email, password_hash,
                            google_id, email_verified, is_anonymous)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      )
      .bind(
        id,
        input.displayName,
        initials,
        ts,
        email,
        input.passwordHash ?? null,
        input.googleId ?? null,
        input.emailVerified ? 1 : 0,
      ),
    db.prepare('INSERT INTO settings (user_id, updated_at) VALUES (?, ?)').bind(id, ts),
  ]);
  return {
    id,
    displayName: input.displayName,
    initials,
    email,
    emailVerified: input.emailVerified,
    isAnonymous: false,
    hasPassword: Boolean(input.passwordHash),
    hasGoogle: Boolean(input.googleId),
  };
}

export async function startSession(
  request: Request,
  db: D1Database,
  secret: string,
  userId: string,
): Promise<{ token: string; cookie: string }> {
  const token = randomToken();
  const maxAge = SESSION_DAYS * 86_400;
  await db
    .prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(
      await sha256(token),
      userId,
      now(),
      now() + maxAge * 1000,
      (request.headers.get('user-agent') ?? '').slice(0, 200),
    )
    .run();
  return { token, cookie: cookieHeader(request, await sign(token, secret), maxAge) };
}

export async function endSession(
  request: Request,
  db: D1Database,
  secret: string,
): Promise<void> {
  const raw = readCookie(request.headers.get('cookie'), COOKIE);
  const token = raw ? await unsign(raw, secret) : null;
  if (!token) return;
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run();
}

/** Изхвърля всички сесии на потребител — при смяна на парола. */
export async function endAllSessions(db: D1Database, userId: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

/* ── Търсене и създаване на профили ─────────────────────────────────────── */

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function findUserByEmail(db: D1Database, email: string): Promise<User | null> {
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email = ?`)
    .bind(normalizeEmail(email))
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export async function getPasswordHash(db: D1Database, userId: string): Promise<string | null> {
  const row = await db
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(userId)
    .first<{ password_hash: string | null }>();
  return row?.password_hash ?? null;
}

export async function findUserByGoogleId(db: D1Database, googleId: string): Promise<User | null> {
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE google_id = ?`)
    .bind(googleId)
    .first<UserRow>();
  return row ? toUser(row) : null;
}

export async function getUser(db: D1Database, userId: string): Promise<User | null> {
  const row = await db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .bind(userId)
    .first<UserRow>();
  return row ? toUser(row) : null;
}

/**
 * Превръща анонимен профил в истински — така тетрадките, направени преди
 * регистрацията, си остават негови без да се местят редове.
 */
export async function upgradeAnonymous(
  db: D1Database,
  userId: string,
  input: {
    email: string;
    displayName: string;
    passwordHash?: string | null;
    googleId?: string | null;
    emailVerified: boolean;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE users SET email = ?, display_name = ?, initials = ?,
         password_hash = COALESCE(?, password_hash),
         google_id = COALESCE(?, google_id),
         email_verified = ?, is_anonymous = 0
       WHERE id = ?`,
    )
    .bind(
      normalizeEmail(input.email),
      input.displayName,
      initialsOf(input.displayName),
      input.passwordHash ?? null,
      input.googleId ?? null,
      input.emailVerified ? 1 : 0,
      userId,
    )
    .run();
}

export async function setPassword(
  db: D1Database,
  userId: string,
  passwordHash: string,
): Promise<void> {
  await db
    .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .bind(passwordHash, userId)
    .run();
}

export async function linkGoogle(
  db: D1Database,
  userId: string,
  googleId: string,
): Promise<void> {
  await db
    .prepare('UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?')
    .bind(googleId, userId)
    .run();
}

export async function markEmailVerified(db: D1Database, userId: string): Promise<void> {
  await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();
}

/**
 * Прехвърля всичко от анонимен профил към профил, който вече съществува
 * (човекът се е пробвал като гост, но има стар акаунт). Анонимният ред отпада.
 */
export async function claimAnonymous(
  db: D1Database,
  fromUserId: string,
  toUserId: string,
): Promise<number> {
  if (fromUserId === toUserId) return 0;

  const guest = await db
    .prepare('SELECT is_anonymous FROM users WHERE id = ?')
    .bind(fromUserId)
    .first<{ is_anonymous: number }>();
  if (!guest || guest.is_anonymous !== 1) return 0;

  const count = await db
    .prepare('SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ?')
    .bind(fromUserId)
    .first<{ c: number }>();

  await db.batch([
    db.prepare('UPDATE notebooks SET user_id = ? WHERE user_id = ?').bind(toUserId, fromUserId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(fromUserId),
    db.prepare('DELETE FROM settings WHERE user_id = ?').bind(fromUserId),
    db.prepare('DELETE FROM usage_counters WHERE user_id = ?').bind(fromUserId),
    db.prepare('DELETE FROM users WHERE id = ? AND is_anonymous = 1').bind(fromUserId),
  ]);

  return count?.c ?? 0;
}

/* ── Еднократни връзки ───────────────────────────────────────────────────── */

export type TokenKind = 'verify' | 'reset';

export async function createEmailToken(
  db: D1Database,
  userId: string,
  kind: TokenKind,
  email: string,
): Promise<string> {
  const token = randomToken();
  const hours = kind === 'verify' ? VERIFY_HOURS : RESET_HOURS;
  // Само последната връзка важи.
  await db
    .prepare('DELETE FROM email_tokens WHERE user_id = ? AND kind = ?')
    .bind(userId, kind)
    .run();
  await db
    .prepare(
      `INSERT INTO email_tokens (token_hash, user_id, kind, email, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(await sha256(token), userId, kind, normalizeEmail(email), now(), now() + hours * 3_600_000)
    .run();
  return token;
}

/** Приема връзката и я маркира като използвана — една връзка, едно ползване. */
export async function consumeEmailToken(
  db: D1Database,
  token: string,
  kind: TokenKind,
): Promise<{ userId: string; email: string } | null> {
  const hash = await sha256(token);
  const row = await db
    .prepare(
      `SELECT user_id, email, expires_at, used_at FROM email_tokens
       WHERE token_hash = ? AND kind = ?`,
    )
    .bind(hash, kind)
    .first<{ user_id: string; email: string; expires_at: number; used_at: number | null }>();

  if (!row || row.used_at !== null || row.expires_at < now()) return null;

  const applied = await db
    .prepare('UPDATE email_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL')
    .bind(now(), hash)
    .run();
  if (!applied.meta.changes) return null;

  return { userId: row.user_id, email: row.email };
}

/* ── Дребни помощни ──────────────────────────────────────────────────────── */

/** Инициали от изписано име: „Радослав Дойников“ → „РД“. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'ЗП';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function isValidEmail(email: string): boolean {
  const clean = email.trim();
  return clean.length >= 5 && clean.length <= 254 && /^[^\s@]+@[^\s@.]+\.[^\s@]{2,}$/.test(clean);
}

/** Изискване към паролата: достатъчно дълга, без забрани за символи. */
export function passwordProblem(password: string): string | null {
  if (password.length < 10) return 'Паролата трябва да е поне 10 знака.';
  if (password.length > 200) return 'Паролата е твърде дълга.';
  if (/^\s|\s$/.test(password)) return 'Паролата не може да започва или свършва с празно място.';
  return null;
}

/** Име по подразбиране от имейла: „radoslav.dodnikov@…“ → „Radoslav Dodnikov“. */
export function nameFromEmail(email: string): string {
  const local = normalizeEmail(email).split('@')[0] ?? 'потребител';
  const words = local
    .split(/[._\-+]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.join(' ').slice(0, 60) || 'Потребител';
}
