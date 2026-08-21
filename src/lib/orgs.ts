/**
 * Организации: създаване, покани, роли.
 *
 * Библиотеката на организацията е тетрадка с `kind='library'` (виж миграция
 * 0005). Тук е единственото място, което я създава и което решава кой има право
 * да пише в нея.
 */

import { HttpError, listMemberships, roleInLibrary, type OrgRole } from './db';
import { newId, now } from './ids';
import { normalizeEmail, sha256 } from './auth';

const INVITE_TTL_MS = 14 * 24 * 60 * 60_000;

/** Ролите, които могат да качват в библиотеката. Членът само чете. */
const CAN_WRITE: OrgRole[] = ['owner', 'admin'];

export interface Org {
  id: string;
  name: string;
  role: OrgRole;
  libraryId: string;
}

/**
 * Създава организация с нейната библиотека и прави създателя собственик.
 *
 * Библиотеката е тетрадка и затова носи `user_id` — създателят. Това е
 * счетоводна собственост, не лична: тя не се брои в квотата му, не излиза в
 * личните му списъци и `getNotebook` не я връща (виж 0005 и `db.ts`). Тръгне ли
 * си човекът, тетрадката се прехвърля на друг собственик — виж
 * `releaseOrgsOfUser`.
 */
export async function createOrg(
  db: D1Database,
  userId: string,
  name: string,
): Promise<Org> {
  const clean = name.trim();
  if (clean.length < 2) throw new HttpError(400, 'Името на организацията е твърде кратко.');
  if (clean.length > 80) throw new HttpError(400, 'Името на организацията е твърде дълго.');

  const orgId = newId('org');
  const libraryId = newId('nb');
  const ts = now();

  await db.batch([
    db
      .prepare('INSERT INTO organizations (id, name, created_at) VALUES (?, ?, ?)')
      .bind(orgId, clean, ts),
    db
      .prepare(
        `INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
      )
      .bind(orgId, userId, ts),
    db
      .prepare(
        `INSERT INTO notebooks (id, user_id, emoji, title, blurb, org_id, kind, created_at, updated_at)
         VALUES (?, ?, '🏛️', ?, '', ?, 'library', ?, ?)`,
      )
      .bind(libraryId, userId, `Библиотека — ${clean}`, orgId, ts, ts),
  ]);

  return { id: orgId, name: clean, role: 'owner', libraryId };
}

/** Организациите на човека, само тези с готова библиотека. */
export async function listOrgs(db: D1Database, userId: string): Promise<Org[]> {
  const memberships = await listMemberships(db, userId);
  return memberships
    .filter((m): m is typeof m & { libraryId: string } => Boolean(m.libraryId))
    .map((m) => ({ id: m.orgId, name: m.name, role: m.role, libraryId: m.libraryId }));
}

/**
 * Ролята на човека върху дадена библиотека, или отказ.
 *
 * `write: true` изисква owner/admin. Всяко пипане по съдържанието на
 * библиотеката минава оттук — иначе проверката се разпилява по маршрутите и
 * някой я пропуска.
 */
export async function requireLibraryRole(
  db: D1Database,
  userId: string,
  libraryId: string,
  opts: { write?: boolean } = {},
): Promise<OrgRole> {
  const role = await roleInLibrary(db, userId, libraryId);
  if (!role) throw new HttpError(404, 'Библиотеката не е намерена.');
  if (opts.write && !CAN_WRITE.includes(role)) {
    throw new HttpError(403, 'Само собственик или администратор може да добавя източници в библиотеката.');
  }
  return role;
}

/* ── Покани ──────────────────────────────────────────────────────────────── */

export interface Invite {
  token: string;
  email: string;
  role: OrgRole;
  expiresAt: number;
}

/** Прави покана и връща токена — вика се веднъж, после токенът не е достъпен. */
export async function inviteToOrg(
  db: D1Database,
  input: { orgId: string; invitedBy: string; email: string; role: OrgRole },
): Promise<Invite> {
  const email = normalizeEmail(input.email);
  if (!email.includes('@')) throw new HttpError(400, 'Имейлът не изглежда валиден.');
  if (input.role === 'owner') {
    throw new HttpError(400, 'Собственик не се задава с покана.');
  }

  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  const expiresAt = now() + INVITE_TTL_MS;

  await db
    .prepare(
      `INSERT INTO org_invites (token_hash, org_id, email, role, invited_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(await sha256(token), input.orgId, email, input.role, input.invitedBy, now(), expiresAt)
    .run();

  return { token, email, role: input.role, expiresAt };
}

/**
 * Приема покана. Връща организацията, в която човекът вече е член.
 *
 * Три проверки, и трите нужни:
 *  • токенът съществува и не е изтекъл;
 *  • не е ползван — иначе една връзка вкарва целия курс;
 *  • имейлът на влезлия съвпада с този на поканата — иначе препратена връзка
 *    вкарва произволен човек в чужда библиотека.
 */
export async function acceptInvite(
  db: D1Database,
  user: { id: string; email: string | null },
  token: string,
): Promise<{ orgId: string; name: string; role: OrgRole }> {
  const row = await db
    .prepare(
      `SELECT i.org_id, i.email, i.role, i.expires_at, i.used_at, o.name
       FROM org_invites i JOIN organizations o ON o.id = i.org_id
       WHERE i.token_hash = ?`,
    )
    .bind(await sha256(token))
    .first<{
      org_id: string;
      email: string;
      role: string;
      expires_at: number;
      used_at: number | null;
      name: string;
    }>();

  if (!row) throw new HttpError(404, 'Поканата не е намерена.');
  if (row.used_at) throw new HttpError(409, 'Поканата вече е използвана.');
  if (row.expires_at <= now()) throw new HttpError(410, 'Поканата е изтекла. Поискай нова.');
  if (normalizeEmail(user.email ?? '') !== row.email) {
    throw new HttpError(
      403,
      `Поканата е за ${row.email}. Влез с този имейл, за да я приемеш.`,
    );
  }

  const ts = now();
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      )
      .bind(row.org_id, user.id, row.role, ts),
    db.prepare('UPDATE org_invites SET used_at = ? WHERE token_hash = ?').bind(ts, await sha256(token)),
  ]);

  return { orgId: row.org_id, name: row.name, role: row.role as OrgRole };
}

/* ── Напускащ човек ──────────────────────────────────────────────────────── */

/**
 * Разплита организациите на човек, който се изтрива по GDPR.
 *
 * Без това библиотеката изчезва заедно с профила на създателя си — тя носи
 * неговия `user_id` — и организацията остава с празни ръце, макар останалите
 * членове да не са направили нищо.
 *
 * Затова: последният собственик отнася организацията със себе си (тя няма кой да
 * я управлява), а иначе библиотеките му се прехвърлят на друг собственик или
 * администратор.
 *
 * Вика се ПРЕДИ изтриването на редовете, докато членството още се вижда.
 */
export async function releaseOrgsOfUser(db: D1Database, userId: string): Promise<void> {
  const { results: orgs } = await db
    .prepare('SELECT org_id, role FROM org_members WHERE user_id = ?')
    .bind(userId)
    .all<{ org_id: string; role: string }>();

  for (const org of orgs ?? []) {
    const heir = await db
      .prepare(
        `SELECT user_id FROM org_members
         WHERE org_id = ? AND user_id != ? AND role IN ('owner', 'admin')
         ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at
         LIMIT 1`,
      )
      .bind(org.org_id, userId)
      .first<{ user_id: string }>();

    if (!heir) {
      // Няма кой да поеме: организацията си отива, а с нея и библиотеката —
      // каскадно през `notebooks.org_id`.
      await db.prepare('DELETE FROM organizations WHERE id = ?').bind(org.org_id).run();
      continue;
    }

    await db
      .prepare(
        `UPDATE notebooks SET user_id = ?
         WHERE org_id = ? AND kind = 'library' AND user_id = ?`,
      )
      .bind(heir.user_id, org.org_id, userId)
      .run();
    await db
      .prepare(`UPDATE org_members SET role = 'owner' WHERE org_id = ? AND user_id = ?`)
      .bind(org.org_id, heir.user_id)
      .run();
  }
}

/* ── Членство: премахване, роли, напускане ───────────────────────────────── */

async function membershipRole(
  db: D1Database,
  orgId: string,
  userId: string,
): Promise<OrgRole | null> {
  const row = await db
    .prepare('SELECT role FROM org_members WHERE org_id = ? AND user_id = ?')
    .bind(orgId, userId)
    .first<{ role: string }>();
  return row ? (row.role as OrgRole) : null;
}

/**
 * Премахва член — или самия себе си (напускане). Правилата:
 *
 * - Всеки освен собственика може да напусне. Собственикът първо прехвърля
 *   собствеността или изтрива организацията — иначе тя остава без управа, а
 *   после наследяването при изтрит профил би решавало тихо това, което тук може
 *   да се откаже гласно.
 * - Собственикът премахва всекиго; администраторът — само членове. Администратор
 *   срещу администратор е покана за война между равни — решава я собственикът.
 */
export async function removeMember(
  db: D1Database,
  orgId: string,
  actorId: string,
  targetId: string,
): Promise<void> {
  const actor = await membershipRole(db, orgId, actorId);
  if (!actor) throw new HttpError(404, 'Организацията не е намерена.');
  const target = await membershipRole(db, orgId, targetId);
  if (!target) throw new HttpError(404, 'Този човек не е член на организацията.');

  if (actorId === targetId) {
    if (actor === 'owner') {
      throw new HttpError(
        409,
        'Собственикът не напуска: първо прехвърли собствеността или изтрий организацията.',
      );
    }
  } else {
    if (actor === 'member') {
      throw new HttpError(403, 'Само собственик или администратор премахва членове.');
    }
    if (target === 'owner') throw new HttpError(403, 'Собственикът не може да бъде премахнат.');
    if (actor === 'admin' && target === 'admin') {
      throw new HttpError(403, 'Администратор не премахва администратор — само собственикът.');
    }
  }

  await db
    .prepare('DELETE FROM org_members WHERE org_id = ? AND user_id = ?')
    .bind(orgId, targetId)
    .run();
}

/**
 * Смяна на роля — само собственикът. `role='owner'` е прехвърляне: новият става
 * собственик, старият пада до администратор, а библиотеката минава на името на
 * новия (същото счетоводство като при наследяване — виж `releaseOrgsOfUser`).
 */
export async function changeRole(
  db: D1Database,
  orgId: string,
  actorId: string,
  targetId: string,
  role: OrgRole,
): Promise<void> {
  if (role !== 'owner' && role !== 'admin' && role !== 'member') {
    throw new HttpError(400, 'Непозната роля.');
  }
  const actor = await membershipRole(db, orgId, actorId);
  if (!actor) throw new HttpError(404, 'Организацията не е намерена.');
  if (actor !== 'owner') throw new HttpError(403, 'Само собственикът сменя роли.');
  if (actorId === targetId) {
    throw new HttpError(400, 'Своята роля не се сменя — прехвърли собствеността на друг.');
  }
  const target = await membershipRole(db, orgId, targetId);
  if (!target) throw new HttpError(404, 'Този човек не е член на организацията.');

  if (role === 'owner') {
    await db.batch([
      db
        .prepare(`UPDATE org_members SET role = 'owner' WHERE org_id = ? AND user_id = ?`)
        .bind(orgId, targetId),
      db
        .prepare(`UPDATE org_members SET role = 'admin' WHERE org_id = ? AND user_id = ?`)
        .bind(orgId, actorId),
      db
        .prepare(`UPDATE notebooks SET user_id = ? WHERE org_id = ? AND kind = 'library'`)
        .bind(targetId, orgId),
    ]);
    return;
  }

  await db
    .prepare('UPDATE org_members SET role = ? WHERE org_id = ? AND user_id = ?')
    .bind(role, orgId, targetId)
    .run();
}

/**
 * Проверява, че викащият е собственик, и връща id-то на библиотеката — редовете
 * на самото изтриване са в `db.ts` (`deleteOrgRows`), а маршрутът първо събира
 * какво да чисти във Vectorize и R2.
 */
export async function requireOrgOwner(
  db: D1Database,
  orgId: string,
  userId: string,
): Promise<{ libraryId: string | null }> {
  const role = await membershipRole(db, orgId, userId);
  if (!role) throw new HttpError(404, 'Организацията не е намерена.');
  if (role !== 'owner') throw new HttpError(403, 'Само собственикът изтрива организацията.');
  const row = await db
    .prepare(`SELECT id FROM notebooks WHERE org_id = ? AND kind = 'library' LIMIT 1`)
    .bind(orgId)
    .first<{ id: string }>();
  return { libraryId: row?.id ?? null };
}

/* ── Админ: платени места ────────────────────────────────────────────────── */

export interface OrgAdminRow {
  id: string;
  name: string;
  members: number;
  seats: number;
  /** Въпроси от общия пакет, похарчени този месец. */
  questionsUsed: number;
}

/** Всички организации, както ги вижда админът: членове, места, разход. */
export async function listOrgsAdmin(db: D1Database, period: string): Promise<OrgAdminRow[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id, o.name, o.seats,
              (SELECT COUNT(*) FROM org_members m WHERE m.org_id = o.id) AS members,
              COALESCE(u.questions, 0) AS used
       FROM organizations o
         LEFT JOIN org_usage_counters u ON u.org_id = o.id AND u.period = ?
       ORDER BY o.name`,
    )
    .bind(period)
    .all<{ id: string; name: string; seats: number; members: number; used: number }>();

  return (results ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    members: r.members,
    seats: r.seats,
    questionsUsed: r.used,
  }));
}

/**
 * Задава платените места. Нула връща организацията на обикновена — библиотеката
 * остава, пакетът изчезва. Минимумът от 10 места е търговско условие, не
 * техническо: админът може да въведе колкото е договорено.
 */
export async function setOrgSeats(db: D1Database, orgId: string, seats: number): Promise<void> {
  if (!Number.isInteger(seats) || seats < 0 || seats > 10_000) {
    throw new HttpError(400, 'Местата са цяло число между 0 и 10000.');
  }
  const res = await db
    .prepare('UPDATE organizations SET seats = ? WHERE id = ?')
    .bind(seats, orgId)
    .run();
  if (!res.meta.changes) throw new HttpError(404, 'Няма такава организация.');
}
