/**
 * Общи набори: готово съдържание, което много хора ползват в своите тетрадки.
 *
 * Наборът е тетрадка с `kind='dataset'` — както библиотеката на организация е
 * тетрадка с `kind='library'`. Затова качването в него минава през същия маршрут
 * за източници и тук няма своя логика за файлове и обработка.
 *
 * Разликата от библиотеката е откъде идва правото: библиотеката се членува
 * (`org_members`), наборът се получава (`dataset_grants`).
 */

import { HttpError } from './db';
import { newId, now } from './ids';

/** Администраторите се четат от променлива, не от базата — виж `isAdmin`. */
export function isAdmin(env: { ADMIN_EMAILS?: string }, email: string | null): boolean {
  if (!email) return false;
  const list = (env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

/**
 * Иска администратор.
 *
 * Ролята е на платформата, не на потребител, затова живее в променлива, а не в
 * колона: няма схема за мигриране, няма как да се сложи с `UPDATE`, и се маха,
 * без да се пипа базата. Съобщението е 404, а не 403 — че изобщо има админ панел
 * не е нужно да се знае отвън.
 */
export function requireAdmin(env: { ADMIN_EMAILS?: string }, email: string | null): void {
  if (!isAdmin(env, email)) throw new HttpError(404, 'Не е намерено.');
}

export interface Dataset {
  id: string;
  title: string;
  emoji: string;
  blurb: string;
  useCases: string[];
  published: boolean;
  /** Свободен за всеки влязъл, без грант. */
  isPublic: boolean;
  sourceCount: number;
  /** Включен ли е в тетрадката, за която питаме. */
  on?: boolean;
}

interface DatasetRow {
  id: string;
  title: string;
  emoji: string;
  blurb: string;
  use_cases: string;
  published_at: number | null;
  is_public: number;
  source_count: number;
  on_here?: number;
}

function toDataset(r: DatasetRow): Dataset {
  return {
    id: r.id,
    title: r.title,
    emoji: r.emoji,
    blurb: r.blurb,
    useCases: r.use_cases ? r.use_cases.split(',').filter(Boolean) : [],
    published: r.published_at !== null,
    isPublic: r.is_public === 1,
    sourceCount: r.source_count,
    ...(r.on_here === undefined ? {} : { on: r.on_here === 1 }),
  };
}

/** Броят се само живите източници: изтеглена редакция не е част от набора. */
const LIVE_SOURCES = `(SELECT COUNT(*) FROM sources s
   WHERE s.notebook_id = n.id AND s.retired_at IS NULL) AS source_count`;

export async function createDataset(
  db: D1Database,
  ownerId: string,
  input: { title: string; blurb?: string; useCases?: string[]; emoji?: string },
): Promise<Dataset> {
  const title = input.title.trim();
  if (title.length < 2) throw new HttpError(400, 'Името на набора е твърде кратко.');

  const id = newId('nb');
  const ts = now();
  await db.batch([
    db
      .prepare(
        `INSERT INTO notebooks (id, user_id, emoji, title, blurb, kind, created_at, updated_at)
         VALUES (?, ?, ?, ?, '', 'dataset', ?, ?)`,
      )
      .bind(id, ownerId, input.emoji || '📚', title, ts, ts),
    db
      .prepare('INSERT INTO datasets_meta (notebook_id, blurb, use_cases) VALUES (?, ?, ?)')
      .bind(id, input.blurb ?? '', (input.useCases ?? []).join(',')),
  ]);

  return {
    id,
    title,
    emoji: input.emoji || '📚',
    blurb: input.blurb ?? '',
    useCases: input.useCases ?? [],
    published: false,
    isPublic: false,
    sourceCount: 0,
  };
}

/** Всички набори — само за администратор, включително непубликуваните. */
export async function listAllDatasets(db: D1Database): Promise<Dataset[]> {
  const { results } = await db
    .prepare(
      `SELECT n.id, n.title, n.emoji, m.blurb, m.use_cases, m.published_at, m.is_public, ${LIVE_SOURCES}
       FROM notebooks n JOIN datasets_meta m ON m.notebook_id = n.id
       WHERE n.kind = 'dataset' ORDER BY n.title`,
    )
    .all<DatasetRow>();
  return (results ?? []).map(toDataset);
}

/**
 * Наборите, до които човекът има право, с отбелязано дали са включени в тази
 * тетрадка.
 *
 * Непубликуваните не излизат дори с право: докато наборът се пълни, съдържанието
 * му е наполовина индексирано и отговорите по него биха били произволни.
 */
export async function listGrantedDatasets(
  db: D1Database,
  userId: string,
  notebookId?: string,
): Promise<Dataset[]> {
  // LEFT JOIN, а не JOIN: свободният набор няма ред в dataset_grants и вътрешното
  // съединение би го скрило точно от хората, за които е свободен.
  const { results } = await db
    .prepare(
      `SELECT n.id, n.title, n.emoji, m.blurb, m.use_cases, m.published_at, m.is_public, ${LIVE_SOURCES},
              (SELECT COUNT(*) FROM notebook_datasets nd
                WHERE nd.dataset_id = n.id AND nd.notebook_id = ?) AS on_here
       FROM notebooks n
         JOIN datasets_meta m ON m.notebook_id = n.id
         LEFT JOIN dataset_grants g ON g.dataset_id = n.id AND g.user_id = ?
       WHERE n.kind = 'dataset'
         AND m.published_at IS NOT NULL
         AND (m.is_public = 1
              OR (g.user_id IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at > ?)))
       ORDER BY n.title`,
    )
    .bind(notebookId ?? '', userId, now())
    .all<DatasetRow>();
  return (results ?? []).map(toDataset);
}

/**
 * Кои набори са включени в тази тетрадка И човекът още има право на тях.
 *
 * ЕДИНСТВЕНОТО място, което решава това — както `listAllowedSources` за
 * източниците. Включен ред не стига: правото може да е изтекло, а наборът може да
 * е бил свален от публикуване. Проверката е в самата заявка, за да няма как да се
 * пропусне някъде нагоре.
 */
export async function allowedDatasetIds(
  db: D1Database,
  userId: string,
  notebookId: string,
): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT nd.dataset_id FROM notebook_datasets nd
         JOIN datasets_meta m ON m.notebook_id = nd.dataset_id
         LEFT JOIN dataset_grants g ON g.dataset_id = nd.dataset_id AND g.user_id = ?
       WHERE nd.notebook_id = ?
         AND m.published_at IS NOT NULL
         AND (m.is_public = 1
              OR (g.user_id IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at > ?)))`,
    )
    .bind(userId, notebookId, now())
    .all<{ dataset_id: string }>();
  return (results ?? []).map((r) => r.dataset_id);
}

/** Включва или изключва набор в тетрадка; правото се проверява тук. */
export async function setNotebookDataset(
  db: D1Database,
  userId: string,
  notebookId: string,
  datasetId: string,
  on: boolean,
): Promise<void> {
  if (!on) {
    await db
      .prepare('DELETE FROM notebook_datasets WHERE notebook_id = ? AND dataset_id = ?')
      .bind(notebookId, datasetId)
      .run();
    return;
  }

  const granted = await db
    .prepare(
      `SELECT 1 AS ok FROM datasets_meta m
         LEFT JOIN dataset_grants g ON g.dataset_id = m.notebook_id AND g.user_id = ?
       WHERE m.notebook_id = ?
         AND m.published_at IS NOT NULL
         AND (m.is_public = 1
              OR (g.user_id IS NOT NULL AND (g.expires_at IS NULL OR g.expires_at > ?)))`,
    )
    .bind(userId, datasetId, now())
    .first<{ ok: number }>();
  if (!granted) throw new HttpError(404, 'Наборът не е намерен.');

  await db
    .prepare(
      'INSERT OR IGNORE INTO notebook_datasets (notebook_id, dataset_id, created_at) VALUES (?, ?, ?)',
    )
    .bind(notebookId, datasetId, now())
    .run();
}

/**
 * Превръща вече съществуваща тетрадка в набор.
 *
 * Смисълът е да НЯМА ново вграждане. Векторите носят в метаданните `notebookId`
 * на тетрадката, а метаданните се менят само с презаписване на векторите — тоест
 * преместване на източник в друга тетрадка значи ново вграждане на всичко. Понеже
 * наборът Е тетрадка, обръщането на самата тетрадка запазва съвпадението и
 * индексът остава както си е.
 *
 * Цената е, че тетрадката спира да е лична: изчезва от списъка, а разговорите и
 * бележките в нея остават в базата, но вече не се отварят. Затова се иска изрично
 * действие от админ, а не се предлага на всеки.
 */
export async function adoptNotebookAsDataset(
  db: D1Database,
  ownerId: string,
  notebookId: string,
  input: { blurb?: string; useCases?: string[] } = {},
): Promise<Dataset> {
  const row = await db
    .prepare(
      `SELECT n.id, n.title, n.emoji,
              (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id) AS total,
              (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id AND s.status = 'ready') AS ready
       FROM notebooks n
       WHERE n.id = ? AND n.user_id = ? AND n.kind = 'personal'`,
    )
    .bind(notebookId, ownerId)
    .first<{ id: string; title: string; emoji: string; total: number; ready: number }>();

  if (!row) throw new HttpError(404, 'Тетрадката не е намерена.');
  if (row.total === 0) throw new HttpError(400, 'Тетрадката е празна.');
  // Наполовина обработена тетрадка би станала наполовина индексиран набор, а по
  // него отговорите изглеждат произволни.
  if (row.ready !== row.total) {
    throw new HttpError(
      409,
      `${row.total - row.ready} от ${row.total} източника още се обработват. Изчакай и опитай пак.`,
    );
  }

  await db.batch([
    db.prepare(`UPDATE notebooks SET kind = 'dataset' WHERE id = ?`).bind(notebookId),
    db
      .prepare(
        `INSERT INTO datasets_meta (notebook_id, blurb, use_cases) VALUES (?, ?, ?)
         ON CONFLICT(notebook_id) DO UPDATE SET blurb = excluded.blurb, use_cases = excluded.use_cases`,
      )
      .bind(notebookId, input.blurb ?? '', (input.useCases ?? []).join(',')),
  ]);

  return {
    id: row.id,
    title: row.title,
    emoji: row.emoji,
    blurb: input.blurb ?? '',
    useCases: input.useCases ?? [],
    published: false,
    isPublic: false,
    sourceCount: row.total,
  };
}

/**
 * Колко общи набора притежава профилът.
 *
 * Наборът е тетрадка с `user_id` на създателя си, а изтриването по GDPR трие
 * всички тетрадки на човека. Без тази проверка админ, който си изтрие профила,
 * отнася Кодекса на труда за всички потребители — тип бъг „никой не го е
 * помислил“, докато не се случи.
 */
export async function countOwnedDatasets(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM notebooks WHERE user_id = ? AND kind = 'dataset'`)
    .bind(userId)
    .first<{ c: number }>();
  return row?.c ?? 0;
}

/* ── Административни ─────────────────────────────────────────────────────── */

export async function publishDataset(
  db: D1Database,
  datasetId: string,
  published: boolean,
): Promise<void> {
  await db
    .prepare('UPDATE datasets_meta SET published_at = ? WHERE notebook_id = ?')
    .bind(published ? now() : null, datasetId)
    .run();
}

/** Свободен ⇄ с достъп. Отделно от publish: двата ключа са различни решения. */
export async function setDatasetPublic(
  db: D1Database,
  datasetId: string,
  isPublic: boolean,
): Promise<void> {
  await db
    .prepare('UPDATE datasets_meta SET is_public = ? WHERE notebook_id = ?')
    .bind(isPublic ? 1 : 0, datasetId)
    .run();
}

export async function updateDatasetMeta(
  db: D1Database,
  datasetId: string,
  patch: { blurb?: string; useCases?: string[] },
): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.blurb !== undefined) {
    sets.push('blurb = ?');
    binds.push(patch.blurb);
  }
  if (patch.useCases !== undefined) {
    sets.push('use_cases = ?');
    binds.push(patch.useCases.join(','));
  }
  if (sets.length === 0) return;
  binds.push(datasetId);
  await db.prepare(`UPDATE datasets_meta SET ${sets.join(', ')} WHERE notebook_id = ?`).bind(...binds).run();
}

/** Дава достъп. Засега се вика от админ панела; после — от плащането. */
export async function grantDataset(
  db: D1Database,
  userId: string,
  datasetId: string,
  expiresAt: number | null = null,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO dataset_grants (user_id, dataset_id, granted_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, dataset_id) DO UPDATE SET expires_at = excluded.expires_at`,
    )
    .bind(userId, datasetId, now(), expiresAt)
    .run();
}
