import { MAX_SOURCES_PER_NOTEBOOK } from './constants';
import { newId, now } from './ids';
import type {
  Citation,
  JobKind,
  JobStatus,
  Message,
  Mindmap,
  Note,
  NoteKind,
  Notebook,
  Settings,
  Source,
  SourceKind,
  SourceStatus,
  StudioJob,
} from './types';
export type { Settings } from './types';

/* ── Тетрадки ─────────────────────────────────────────────────────────────── */

interface NotebookRow {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  store_name: string | null;
  created_at: number;
  updated_at: number;
  source_count?: number;
}

function toNotebook(r: NotebookRow): Notebook {
  return {
    id: r.id,
    emoji: r.emoji,
    title: r.title,
    blurb: r.blurb,
    storeName: r.store_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    sourceCount: r.source_count ?? 0,
    meta: notebookMeta(r.source_count ?? 0, r.updated_at),
  };
}

export async function listNotebooks(db: D1Database, userId: string): Promise<Notebook[]> {
  const { results } = await db
    .prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id) AS source_count
       FROM notebooks n WHERE n.user_id = ? AND n.kind = 'personal' ORDER BY n.updated_at DESC`,
    )
    .bind(userId)
    .all<NotebookRow>();
  return results.map(toNotebook);
}

export async function getNotebook(
  db: D1Database,
  userId: string,
  id: string,
): Promise<Notebook | null> {
  const row = await db
    .prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id) AS source_count
       FROM notebooks n WHERE n.id = ? AND n.user_id = ? AND n.kind = 'personal'`,
    )
    .bind(id, userId)
    .first<NotebookRow>();
  return row ? toNotebook(row) : null;
}

/**
 * Библиотеката по id, без проверка кой пита — проверката за роля е отделна
 * (`requireLibraryRole`). `getNotebook` нарочно не я връща: тя не се управлява
 * като лична тетрадка.
 */
export async function getLibraryNotebook(
  db: D1Database,
  id: string,
): Promise<Notebook | null> {
  const row = await db
    .prepare(
      `SELECT n.*, (SELECT COUNT(*) FROM sources s WHERE s.notebook_id = n.id) AS source_count
       FROM notebooks n WHERE n.id = ? AND n.kind = 'library'`,
    )
    .bind(id)
    .first<NotebookRow>();
  return row ? toNotebook(row) : null;
}

export async function createNotebook(
  db: D1Database,
  userId: string,
  input: { title?: string; emoji?: string; blurb?: string } = {},
): Promise<Notebook> {
  const ts = now();
  const id = newId('nb');
  const title = input.title?.trim() || 'Нова тетрадка';
  const emoji = input.emoji || '📓';
  const blurb = input.blurb ?? '';
  await db
    .prepare(
      `INSERT INTO notebooks (id, user_id, emoji, title, blurb, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, emoji, title, blurb, ts, ts)
    .run();
  return {
    id,
    emoji,
    title,
    blurb,
    storeName: null,
    createdAt: ts,
    updatedAt: ts,
    sourceCount: 0,
    meta: notebookMeta(0, ts),
  };
}

export async function updateNotebook(
  db: D1Database,
  userId: string,
  id: string,
  patch: { title?: string; emoji?: string; blurb?: string; storeName?: string },
): Promise<void> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    binds.push(patch.title);
  }
  if (patch.emoji !== undefined) {
    sets.push('emoji = ?');
    binds.push(patch.emoji);
  }
  if (patch.blurb !== undefined) {
    sets.push('blurb = ?');
    binds.push(patch.blurb);
  }
  if (patch.storeName !== undefined) {
    sets.push('store_name = ?');
    binds.push(patch.storeName);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  binds.push(now(), id, userId);
  await db
    .prepare(`UPDATE notebooks SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...binds)
    .run();
}

export async function touchNotebook(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').bind(now(), id).run();
}

export async function deleteNotebook(
  db: D1Database,
  userId: string,
  id: string,
): Promise<void> {
  // D1 не налага външни ключове по подразбиране, така че чистим ръчно.
  await db.batch([
    db.prepare('DELETE FROM chunks WHERE notebook_id = ?').bind(id),
    db
      .prepare('DELETE FROM citations WHERE message_id IN (SELECT id FROM messages WHERE notebook_id = ?)')
      .bind(id),
    db.prepare('DELETE FROM messages WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM notes WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM sources WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM studio_jobs WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM mindmaps WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?').bind(id, userId),
  ]);
}

/* ── Източници ───────────────────────────────────────────────────────────── */

interface SourceRow {
  id: string;
  notebook_id: string;
  ordinal: number;
  kind: string;
  name: string;
  sub: string;
  origin_url: string | null;
  r2_key: string | null;
  byte_size: number;
  page_count: number;
  char_count: number;
  selected: number;
  status: string;
  error: string | null;
  doc_name: string | null;
  created_at: number;
}

function toSource(r: SourceRow): Source {
  return {
    id: r.id,
    notebookId: r.notebook_id,
    ordinal: r.ordinal,
    kind: r.kind as SourceKind,
    name: r.name,
    sub: r.sub,
    originUrl: r.origin_url,
    r2Key: r.r2_key,
    byteSize: r.byte_size,
    pageCount: r.page_count,
    charCount: r.char_count,
    selected: r.selected === 1,
    status: r.status as SourceStatus,
    error: r.error,
    docName: r.doc_name,
    createdAt: r.created_at,
  };
}

export async function listSources(db: D1Database, notebookId: string): Promise<Source[]> {
  const { results } = await db
    .prepare('SELECT * FROM sources WHERE notebook_id = ? ORDER BY ordinal')
    .bind(notebookId)
    .all<SourceRow>();
  return results.map(toSource);
}

/**
 * Източниците, по които тетрадката има право да отговаря: своите плюс включените
 * от библиотека на организация.
 *
 * ЕДИНСТВЕНОТО място, което решава това. Извличането вече не стеснява по
 * тетрадка — един пасаж от библиотеката принадлежи на тетрадката на
 * организацията, не на тази, която пита — тоест преградата е тук и само тук.
 * Затова заявката за библиотечните източници минава през членството: включена
 * връзка не стига, ако човекът вече не е член.
 *
 * `ordinal` на библиотечните продължава след своите, за да не се дублират
 * номерата в цитатите („3 · име, стр. 12“).
 */
export async function listAllowedSources(
  db: D1Database,
  userId: string,
  notebookId: string,
): Promise<Source[]> {
  const own = await listSources(db, notebookId);

  const { results } = await db
    .prepare(
      `SELECT s.* FROM notebook_library_sources l
         JOIN sources s   ON s.id = l.source_id
         JOIN notebooks n ON n.id = s.notebook_id
         JOIN org_members m ON m.org_id = n.org_id
       WHERE l.notebook_id = ?
         AND n.kind = 'library'
         AND m.user_id = ?
       ORDER BY s.ordinal`,
    )
    .bind(notebookId, userId)
    .all<SourceRow>();

  const shared = results.map(toSource);
  if (shared.length === 0) return own;

  const offset = own.reduce((max, s) => Math.max(max, s.ordinal), 0);
  return [...own, ...shared.map((s, i) => ({ ...s, ordinal: offset + i + 1 }))];
}

/* ── Организации ─────────────────────────────────────────────────────────── */

export type OrgRole = 'owner' | 'admin' | 'member';

export interface OrgMembership {
  orgId: string;
  name: string;
  role: OrgRole;
  libraryId: string | null;
}

/** Организациите на човека, с ролята му и тетрадката-библиотека на всяка. */
export async function listMemberships(
  db: D1Database,
  userId: string,
): Promise<OrgMembership[]> {
  const { results } = await db
    .prepare(
      `SELECT o.id AS org_id, o.name, m.role,
              (SELECT n.id FROM notebooks n
                WHERE n.org_id = o.id AND n.kind = 'library' LIMIT 1) AS library_id
       FROM org_members m JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = ? ORDER BY o.name`,
    )
    .bind(userId)
    .all<{ org_id: string; name: string; role: string; library_id: string | null }>();

  return results.map((r) => ({
    orgId: r.org_id,
    name: r.name,
    role: r.role as OrgRole,
    libraryId: r.library_id,
  }));
}

/**
 * Ролята на човека в организацията, притежаваща дадена библиотека — или `null`,
 * ако не е член. Ползва се, преди да се пипне съдържанието на библиотеката.
 */
export async function roleInLibrary(
  db: D1Database,
  userId: string,
  libraryId: string,
): Promise<OrgRole | null> {
  const row = await db
    .prepare(
      `SELECT m.role FROM notebooks n
         JOIN org_members m ON m.org_id = n.org_id
       WHERE n.id = ? AND n.kind = 'library' AND m.user_id = ?`,
    )
    .bind(libraryId, userId)
    .first<{ role: string }>();
  return row ? (row.role as OrgRole) : null;
}

/** Включва или изключва източник от библиотека в лична тетрадка. */
export async function setLibrarySource(
  db: D1Database,
  notebookId: string,
  sourceId: string,
  on: boolean,
): Promise<void> {
  if (on) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO notebook_library_sources (notebook_id, source_id, created_at)
         VALUES (?, ?, ?)`,
      )
      .bind(notebookId, sourceId, now())
      .run();
    return;
  }
  await db
    .prepare('DELETE FROM notebook_library_sources WHERE notebook_id = ? AND source_id = ?')
    .bind(notebookId, sourceId)
    .run();
}

export async function getSource(
  db: D1Database,
  notebookId: string,
  id: string,
): Promise<Source | null> {
  const row = await db
    .prepare('SELECT * FROM sources WHERE id = ? AND notebook_id = ?')
    .bind(id, notebookId)
    .first<SourceRow>();
  return row ? toSource(row) : null;
}

export async function createSource(
  db: D1Database,
  notebookId: string,
  input: {
    kind: SourceKind;
    name: string;
    sub?: string;
    originUrl?: string | null;
    r2Key?: string | null;
    byteSize?: number;
  },
): Promise<Source> {
  const row = await db
    .prepare('SELECT COALESCE(MAX(ordinal), 0) AS n, COUNT(*) AS c FROM sources WHERE notebook_id = ?')
    .bind(notebookId)
    .first<{ n: number; c: number }>();
  if ((row?.c ?? 0) >= MAX_SOURCES_PER_NOTEBOOK) {
    throw new HttpError(409, `Тетрадката вече има ${MAX_SOURCES_PER_NOTEBOOK} източника.`);
  }
  const ordinal = (row?.n ?? 0) + 1;
  const id = newId('src');
  const ts = now();
  await db
    .prepare(
      `INSERT INTO sources (id, notebook_id, ordinal, kind, name, sub, origin_url, r2_key, byte_size, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    )
    .bind(
      id,
      notebookId,
      ordinal,
      input.kind,
      input.name,
      input.sub ?? '',
      input.originUrl ?? null,
      input.r2Key ?? null,
      input.byteSize ?? 0,
      ts,
    )
    .run();
  return {
    id,
    notebookId,
    ordinal,
    kind: input.kind,
    name: input.name,
    sub: input.sub ?? '',
    originUrl: input.originUrl ?? null,
    r2Key: input.r2Key ?? null,
    byteSize: input.byteSize ?? 0,
    pageCount: 0,
    charCount: 0,
    selected: true,
    status: 'pending',
    error: null,
    docName: null,
    createdAt: ts,
  };
}

export async function updateSourceStatus(
  db: D1Database,
  id: string,
  patch: {
    status: SourceStatus;
    error?: string | null;
    pageCount?: number;
    charCount?: number;
    sub?: string;
    docName?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE sources SET status = ?, error = ?,
         page_count = COALESCE(?, page_count),
         char_count = COALESCE(?, char_count),
         sub        = COALESCE(?, sub),
         doc_name   = COALESCE(?, doc_name)
       WHERE id = ?`,
    )
    .bind(
      patch.status,
      patch.error ?? null,
      patch.pageCount ?? null,
      patch.charCount ?? null,
      patch.sub ?? null,
      patch.docName ?? null,
      id,
    )
    .run();
}

export async function setSourceSelected(
  db: D1Database,
  notebookId: string,
  ids: string[],
  selected: boolean,
): Promise<void> {
  if (ids.length === 0) return;
  const marks = ids.map(() => '?').join(', ');
  await db
    .prepare(
      `UPDATE sources SET selected = ? WHERE notebook_id = ? AND id IN (${marks})`,
    )
    .bind(selected ? 1 : 0, notebookId, ...ids)
    .run();
}

export async function deleteSource(db: D1Database, notebookId: string, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM chunks WHERE source_id = ?').bind(id),
    db.prepare('DELETE FROM sources WHERE id = ? AND notebook_id = ?').bind(id, notebookId),
  ]);
}

/* ── Пасажи (chunks) ──────────────────────────────────────────────────────── */

export interface ChunkRow {
  id: string;
  source_id: string;
  notebook_id: string;
  ordinal: number;
  page: number | null;
  locator: string;
  text: string;
}

export async function insertChunks(
  db: D1Database,
  rows: Omit<ChunkRow, never>[],
): Promise<void> {
  const ts = now();
  // D1 приема до 100 израза на batch; държим се доста под лимита.
  for (let i = 0; i < rows.length; i += 50) {
    const slice = rows.slice(i, i + 50);
    await db.batch(
      slice.map((c) =>
        db
          .prepare(
            `INSERT INTO chunks (id, source_id, notebook_id, ordinal, page, locator, text, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(c.id, c.source_id, c.notebook_id, c.ordinal, c.page, c.locator, c.text, ts),
      ),
    );
  }
}

export async function getChunksByIds(db: D1Database, ids: string[]): Promise<ChunkRow[]> {
  if (ids.length === 0) return [];
  const marks = ids.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT id, source_id, notebook_id, ordinal, page, locator, text FROM chunks WHERE id IN (${marks})`)
    .bind(...ids)
    .all<ChunkRow>();
  return results;
}

/**
 * Търсене по думи през FTS5 — връща само идентификатори, подредени по BM25.
 *
 * Стеснява се до разрешените източници още тук, за да не заемат място в
 * класирането пасажи, които после ще отпаднат. По източник, а не по тетрадка:
 * само това важи и за общите библиотеки.
 *
 * Грешка не се пуска нагоре: индексът е допълнение към векторното търсене и ако
 * той не отговори (непусната миграция например), отговорът трябва да излезе с
 * това, което Vectorize е намерил, вместо целият въпрос да гръмне.
 */
export async function searchChunksByKeyword(
  db: D1Database,
  sourceIds: string[],
  match: string,
  limit: number,
): Promise<string[]> {
  if (sourceIds.length === 0) return [];
  const marks = sourceIds.map(() => '?').join(', ');
  try {
    const { results } = await db
      .prepare(
        `SELECT chunk_id FROM chunks_fts
         WHERE chunks_fts MATCH ?
           AND source_id IN (${marks})
         ORDER BY bm25(chunks_fts)
         LIMIT ?`,
      )
      .bind(match, ...sourceIds, limit)
      .all<{ chunk_id: string }>();
    return results.map((r) => r.chunk_id);
  } catch (err) {
    console.error('[zapiski:fts]', err);
    return [];
  }
}

export async function getChunkIdsForSources(
  db: D1Database,
  sourceIds: string[],
): Promise<string[]> {
  if (sourceIds.length === 0) return [];
  const marks = sourceIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(`SELECT id FROM chunks WHERE source_id IN (${marks})`)
    .bind(...sourceIds)
    .all<{ id: string }>();
  return results.map((r) => r.id);
}

/** Всички пасажи от избраните източници, подредени за четене — за резюмета и подкаст. */
export async function getChunksForSources(
  db: D1Database,
  sourceIds: string[],
  limit = 400,
): Promise<ChunkRow[]> {
  if (sourceIds.length === 0) return [];
  const marks = sourceIds.map(() => '?').join(', ');
  const { results } = await db
    .prepare(
      `SELECT c.id, c.source_id, c.notebook_id, c.ordinal, c.page, c.locator, c.text
       FROM chunks c JOIN sources s ON s.id = c.source_id
       WHERE c.source_id IN (${marks})
       ORDER BY s.ordinal, c.ordinal
       LIMIT ?`,
    )
    .bind(...sourceIds, limit)
    .all<ChunkRow>();
  return results;
}

/* ── Съобщения и цитати ──────────────────────────────────────────────────── */

export async function listMessages(db: D1Database, notebookId: string): Promise<Message[]> {
  const { results } = await db
    .prepare('SELECT id, role, text, created_at FROM messages WHERE notebook_id = ? ORDER BY created_at')
    .bind(notebookId)
    .all<{ id: string; role: string; text: string; created_at: number }>();
  if (results.length === 0) return [];

  const marks = results.map(() => '?').join(', ');
  const { results: cites } = await db
    .prepare(
      `SELECT message_id, ordinal, source_id, label, locator, snippet
       FROM citations WHERE message_id IN (${marks}) ORDER BY ordinal`,
    )
    .bind(...results.map((m) => m.id))
    .all<{
      message_id: string;
      ordinal: number;
      source_id: string | null;
      label: string;
      locator: string;
      snippet: string;
    }>();

  const byMessage = new Map<string, Citation[]>();
  for (const c of cites) {
    const list = byMessage.get(c.message_id) ?? [];
    list.push({
      ordinal: c.ordinal,
      sourceId: c.source_id,
      label: c.label,
      locator: c.locator,
      snippet: c.snippet,
    });
    byMessage.set(c.message_id, list);
  }

  return results.map((m) => ({
    id: m.id,
    role: m.role as 'user' | 'ai',
    text: m.text,
    createdAt: m.created_at,
    citations: byMessage.get(m.id) ?? [],
  }));
}

export async function insertMessage(
  db: D1Database,
  notebookId: string,
  role: 'user' | 'ai',
  text: string,
  citations: Citation[] = [],
): Promise<Message> {
  const id = newId('msg');
  const ts = now();
  const stmts = [
    db
      .prepare('INSERT INTO messages (id, notebook_id, role, text, created_at) VALUES (?, ?, ?, ?, ?)')
      .bind(id, notebookId, role, text, ts),
    ...citations.map((c) =>
      db
        .prepare(
          `INSERT INTO citations (id, message_id, ordinal, source_id, label, locator, snippet)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId('cit'), id, c.ordinal, c.sourceId, c.label, c.locator, c.snippet),
    ),
  ];
  await db.batch(stmts);
  return { id, role, text, createdAt: ts, citations };
}

export async function clearMessages(db: D1Database, notebookId: string): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM citations WHERE message_id IN (SELECT id FROM messages WHERE notebook_id = ?)')
      .bind(notebookId),
    db.prepare('DELETE FROM messages WHERE notebook_id = ?').bind(notebookId),
  ]);
}

/* ── Бележки ─────────────────────────────────────────────────────────────── */

export async function listNotes(db: D1Database, notebookId: string): Promise<Note[]> {
  const { results } = await db
    .prepare('SELECT id, kind, title, body, created_at FROM notes WHERE notebook_id = ? ORDER BY created_at DESC')
    .bind(notebookId)
    .all<{ id: string; kind: string; title: string; body: string; created_at: number }>();
  return results.map((n) => ({
    id: n.id,
    kind: n.kind as NoteKind,
    title: n.title,
    body: n.body,
    createdAt: n.created_at,
  }));
}

export async function createNote(
  db: D1Database,
  notebookId: string,
  input: { kind?: NoteKind; title: string; body?: string },
): Promise<Note> {
  const id = newId('note');
  const ts = now();
  const kind = input.kind ?? 'note';
  const body = input.body ?? '';
  await db
    .prepare('INSERT INTO notes (id, notebook_id, kind, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, notebookId, kind, input.title, body, ts)
    .run();
  return { id, kind, title: input.title, body, createdAt: ts };
}

export async function updateNote(
  db: D1Database,
  notebookId: string,
  id: string,
  patch: { title?: string; body?: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE notes SET title = COALESCE(?, title), body = COALESCE(?, body)
       WHERE id = ? AND notebook_id = ?`,
    )
    .bind(patch.title ?? null, patch.body ?? null, id, notebookId)
    .run();
}

export async function deleteNote(db: D1Database, notebookId: string, id: string): Promise<void> {
  await db.prepare('DELETE FROM notes WHERE id = ? AND notebook_id = ?').bind(id, notebookId).run();
}

/* ── Задачи в студиото ───────────────────────────────────────────────────── */

interface JobRow {
  id: string;
  kind: string;
  status: string;
  step: string;
  progress: number;
  result_json: string | null;
  r2_key: string | null;
  duration_s: number;
  error: string | null;
  updated_at: number;
}

function toJob(r: JobRow): StudioJob {
  return {
    id: r.id,
    kind: r.kind as JobKind,
    status: r.status as JobStatus,
    step: r.step,
    progress: r.progress,
    durationS: r.duration_s,
    error: r.error,
    updatedAt: r.updated_at,
    result: r.result_json ? safeParse(r.result_json) : undefined,
  };
}

/**
 * Колко време без нито един запис значи, че задачата е умряла.
 *
 * Фоновата работа живее в `waitUntil` на една заявка. Ако Cloudflare прекрати
 * изолата (дълга задача, разгръщане, срив), обещанието не се изпълнява и никой
 * не пише „error“ — редът остава „running“ завинаги, а интерфейсът върти
 * безкрайно. Всяка стъпка обновява `updated_at`, така че липсата на записи е
 * единственият признак, по който това се разпознава отвън.
 */
export const JOB_STALE_MS = 3 * 60_000;

export function isJobStale(job: StudioJob, atMs = Date.now()): boolean {
  if (job.status !== 'running' && job.status !== 'queued') return false;
  if (!job.updatedAt) return false;
  return atMs - job.updatedAt > JOB_STALE_MS;
}

/** Отписва замряла задача, за да не блокира следващите опити. */
export async function failStaleJob(db: D1Database, job: StudioJob): Promise<StudioJob> {
  const error =
    'Генерирането прекъсна, преди да завърши. Дългите аудио прегледи понякога не се вместват в едно изпълнение — опитай пак, по възможност с по-кратка дължина.';
  await updateJob(db, job.id, { status: 'error', step: '', error });
  return { ...job, status: 'error', step: '', error };
}

export async function createJob(
  db: D1Database,
  notebookId: string,
  kind: JobKind,
): Promise<StudioJob> {
  const id = newId('job');
  const ts = now();
  await db
    .prepare(
      `INSERT INTO studio_jobs (id, notebook_id, kind, status, step, progress, created_at, updated_at)
       VALUES (?, ?, ?, 'queued', '', 0, ?, ?)`,
    )
    .bind(id, notebookId, kind, ts, ts)
    .run();
  return { id, kind, status: 'queued', step: '', progress: 0, durationS: 0, error: null };
}

export async function updateJob(
  db: D1Database,
  id: string,
  patch: {
    status?: JobStatus;
    step?: string;
    progress?: number;
    resultJson?: string | null;
    r2Key?: string | null;
    durationS?: number;
    error?: string | null;
  },
): Promise<void> {
  await db
    .prepare(
      `UPDATE studio_jobs SET
         status      = COALESCE(?, status),
         step        = COALESCE(?, step),
         progress    = COALESCE(?, progress),
         result_json = COALESCE(?, result_json),
         r2_key      = COALESCE(?, r2_key),
         duration_s  = COALESCE(?, duration_s),
         error       = ?,
         updated_at  = ?
       WHERE id = ?`,
    )
    .bind(
      patch.status ?? null,
      patch.step ?? null,
      patch.progress ?? null,
      patch.resultJson ?? null,
      patch.r2Key ?? null,
      patch.durationS ?? null,
      patch.error ?? null,
      now(),
      id,
    )
    .run();
}

export async function getJob(
  db: D1Database,
  notebookId: string,
  id: string,
): Promise<StudioJob | null> {
  const row = await db
    .prepare(
      `SELECT id, kind, status, step, progress, result_json, r2_key, duration_s, error, updated_at
       FROM studio_jobs WHERE id = ? AND notebook_id = ?`,
    )
    .bind(id, notebookId)
    .first<JobRow>();
  if (!row) return null;
  const job = toJob(row);
  if (row.r2_key) job.audioUrl = `/api/notebooks/${notebookId}/audio/${row.id}`;
  return job;
}

export async function getLatestJob(
  db: D1Database,
  notebookId: string,
  kind: JobKind,
): Promise<StudioJob | null> {
  const row = await db
    .prepare(
      `SELECT id, kind, status, step, progress, result_json, r2_key, duration_s, error, updated_at
       FROM studio_jobs WHERE notebook_id = ? AND kind = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(notebookId, kind)
    .first<JobRow>();
  if (!row) return null;
  const job = toJob(row);
  if (row.r2_key) job.audioUrl = `/api/notebooks/${notebookId}/audio/${row.id}`;
  return job;
}

export async function getJobR2Key(
  db: D1Database,
  notebookId: string,
  id: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT r2_key FROM studio_jobs WHERE id = ? AND notebook_id = ?')
    .bind(id, notebookId)
    .first<{ r2_key: string | null }>();
  return row?.r2_key ?? null;
}

/* ── Мисловна карта ──────────────────────────────────────────────────────── */

export async function getMindmap(db: D1Database, notebookId: string): Promise<Mindmap | null> {
  const row = await db
    .prepare('SELECT json FROM mindmaps WHERE notebook_id = ?')
    .bind(notebookId)
    .first<{ json: string }>();
  if (!row) return null;
  return safeParse(row.json) as Mindmap | null;
}

export async function saveMindmap(
  db: D1Database,
  notebookId: string,
  map: Mindmap,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO mindmaps (notebook_id, json, created_at) VALUES (?, ?, ?)
       ON CONFLICT(notebook_id) DO UPDATE SET json = excluded.json, created_at = excluded.created_at`,
    )
    .bind(notebookId, JSON.stringify(map), now())
    .run();
}

/* ── Настройки и профил ──────────────────────────────────────────────────── */

export async function getSettings(db: D1Database, userId: string): Promise<Settings> {
  const row = await db
    .prepare('SELECT response_language, offline_mode, chat_model FROM settings WHERE user_id = ?')
    .bind(userId)
    .first<{ response_language: string; offline_mode: number; chat_model: string }>();
  return {
    responseLanguage: row?.response_language ?? 'bg',
    offlineMode: (row?.offline_mode ?? 1) === 1,
    // Празно значи „каквото е зададено за инсталацията“ — виж ai/choices.ts.
    chatModel: row?.chat_model ?? '',
  };
}

export async function saveSettings(
  db: D1Database,
  userId: string,
  patch: Partial<Settings>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO settings (user_id, response_language, offline_mode, chat_model, updated_at)
       VALUES (?, COALESCE(?, 'bg'), COALESCE(?, 1), COALESCE(?, ''), ?)
       ON CONFLICT(user_id) DO UPDATE SET
         response_language = COALESCE(excluded.response_language, settings.response_language),
         offline_mode      = COALESCE(excluded.offline_mode, settings.offline_mode),
         chat_model        = COALESCE(excluded.chat_model, settings.chat_model),
         updated_at        = excluded.updated_at`,
    )
    .bind(
      userId,
      patch.responseLanguage ?? null,
      patch.offlineMode === undefined ? null : patch.offlineMode ? 1 : 0,
      patch.chatModel ?? null,
      now(),
    )
    .run();
}

export async function saveProfile(
  db: D1Database,
  userId: string,
  displayName: string,
  initials: string,
): Promise<void> {
  await db
    .prepare('UPDATE users SET display_name = ?, initials = ? WHERE id = ?')
    .bind(displayName, initials, userId)
    .run();
}

/* ── Помощни ─────────────────────────────────────────────────────────────── */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** „5 източника · вчера“ */
export function notebookMeta(sourceCount: number, updatedAt: number): string {
  const word = sourceCount === 1 ? 'източник' : 'източника';
  return `${sourceCount} ${word} · ${relativeTime(updatedAt)}`;
}

export function relativeTime(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  if (days <= 0) return 'днес';
  if (days === 1) return 'вчера';
  if (days < 7) return `преди ${days} дни`;
  if (days < 14) return 'миналата седмица';
  if (days < 60) return 'преди месец';
  const months = Math.round(days / 30);
  if (months < 12) return `преди ${months} месеца`;
  return 'преди повече от година';
}

/* ── Профилът като цяло: износ и изтриване ───────────────────────────────── */

/** Всичко, което трябва да се изчисти извън D1, преди редовете да изчезнат. */
export interface UserFootprint {
  notebookIds: string[];
  /** Идентификаторите на пасажите — те са и идентификаторите във Vectorize. */
  chunkIds: string[];
  /** Оригиналните файлове в R2. */
  r2Keys: string[];
  /** File Search хранилищата на Google, ако RAG_BACKEND е „gemini“. */
  storeNames: string[];
}

/**
 * Какво притежава един профил извън D1.
 *
 * Събира се ПРЕДИ изтриването: след като редовете ги няма, няма как да се
 * разбере кои вектори и кои файлове са били негови, а те остават да заемат
 * място и — по-важното — остават налични.
 */
export async function collectUserFootprint(
  db: D1Database,
  userId: string,
): Promise<UserFootprint> {
  const [notebooks, chunks, sources] = await Promise.all([
    db
      .prepare('SELECT id, store_name FROM notebooks WHERE user_id = ?')
      .bind(userId)
      .all<{ id: string; store_name: string | null }>(),
    db
      .prepare('SELECT id FROM chunks WHERE notebook_id IN (SELECT id FROM notebooks WHERE user_id = ?)')
      .bind(userId)
      .all<{ id: string }>(),
    db
      .prepare(
        `SELECT r2_key FROM sources
         WHERE r2_key IS NOT NULL
           AND notebook_id IN (SELECT id FROM notebooks WHERE user_id = ?)`,
      )
      .bind(userId)
      .all<{ r2_key: string }>(),
  ]);

  return {
    notebookIds: (notebooks.results ?? []).map((n) => n.id),
    chunkIds: (chunks.results ?? []).map((c) => c.id),
    r2Keys: (sources.results ?? []).map((s) => s.r2_key),
    storeNames: (notebooks.results ?? [])
      .map((n) => n.store_name)
      .filter((name): name is string => Boolean(name)),
  };
}

/**
 * Трие всички редове на профила и накрая самия профил.
 *
 * След миграция 0004 всяка таблица с `user_id` каскадира от `users`, и това е
 * проверено: един `DELETE FROM users` изчиства и единайсетте таблици, включително
 * `chunks_fts` през тригера. Тоест списъкът тук вече НЕ е единственото, което
 * пази данните да не остават.
 *
 * И въпреки това остава, защото двата пътя покриват различни провали:
 *
 *  • Каскадата покрива **забравена таблица** — включително такава, добавена
 *    по-късно, за която никой не се е сетил да допише ред тук.
 *  • Изричният списък покрива **среда, която не налага външните ключове**. Ако
 *    се разчиташе само на каскадата и D1 някога спре да ги налага, профилът би
 *    „изчезвал“, а всичко негово би оставало — тихо, без грешка.
 *
 * Затова не се съкращава до два реда, макар да изглежда, че може. Изтриването по
 * GDPR е точно мястото, където тихият провал е най-скъп.
 *
 * `rate_limits` е единствената, която не може да каскадира: ключът ѝ носи имейла
 * (`rl_<имейл>_<ip>`), а не `user_id`.
 */
export async function deleteUserRows(db: D1Database, userId: string): Promise<void> {
  const inNotebooks = 'IN (SELECT id FROM notebooks WHERE user_id = ?)';
  await db.batch([
    db.prepare(`DELETE FROM citations WHERE message_id IN (SELECT id FROM messages WHERE notebook_id ${inNotebooks})`).bind(userId),
    db.prepare(`DELETE FROM chunks WHERE notebook_id ${inNotebooks}`).bind(userId),
    db.prepare(`DELETE FROM messages WHERE notebook_id ${inNotebooks}`).bind(userId),
    db.prepare(`DELETE FROM notes WHERE notebook_id ${inNotebooks}`).bind(userId),
    db.prepare(`DELETE FROM sources WHERE notebook_id ${inNotebooks}`).bind(userId),
    db.prepare(`DELETE FROM studio_jobs WHERE notebook_id ${inNotebooks}`).bind(userId),
    db.prepare(`DELETE FROM mindmaps WHERE notebook_id ${inNotebooks}`).bind(userId),
    db.prepare('DELETE FROM notebooks WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM settings WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM email_tokens WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM subscriptions WHERE user_id = ?').bind(userId),
    db.prepare('DELETE FROM usage_counters WHERE user_id = ?').bind(userId),
    // Ключът на брояча за опити носи самия имейл (`rl_<имейл>_<ip>`), тоест е
    // лични данни и той. Върви ПРЕДИ реда в users, защото оттам си взима
    // имейла. `_` в LIKE е шаблон за един знак — тук е без значение, защото
    // имейлът по средата е буквален.
    db
      .prepare(
        `DELETE FROM rate_limits
         WHERE key LIKE (SELECT 'rl_' || email || '_%' FROM users WHERE id = ?)`,
      )
      .bind(userId),
    db.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
}

/**
 * Всичко за профила в четим вид — правото на преносимост по GDPR.
 * Само неща, които човекът е създал или е дал сам; хешове и токени не влизат.
 */
export async function exportUserData(db: D1Database, userId: string): Promise<unknown> {
  const [user, settings, notebooks, sources, messages, notes, subscription, usage] =
    await Promise.all([
      db
        .prepare('SELECT id, display_name, email, email_verified, created_at FROM users WHERE id = ?')
        .bind(userId)
        .first(),
      db.prepare('SELECT response_language, offline_mode, chat_model FROM settings WHERE user_id = ?').bind(userId).first(),
      db.prepare('SELECT id, title, emoji, blurb, created_at, updated_at FROM notebooks WHERE user_id = ?').bind(userId).all(),
      db
        .prepare(
          `SELECT id, notebook_id, kind, name, sub, origin_url, page_count, char_count, created_at
           FROM sources WHERE notebook_id IN (SELECT id FROM notebooks WHERE user_id = ?)`,
        )
        .bind(userId)
        .all(),
      db
        .prepare(
          `SELECT id, notebook_id, role, text, created_at
           FROM messages WHERE notebook_id IN (SELECT id FROM notebooks WHERE user_id = ?)`,
        )
        .bind(userId)
        .all(),
      db
        .prepare(
          `SELECT id, notebook_id, kind, title, body, created_at
           FROM notes WHERE notebook_id IN (SELECT id FROM notebooks WHERE user_id = ?)`,
        )
        .bind(userId)
        .all(),
      db
        .prepare('SELECT plan, status, interval, current_period_end, cancel_at_period_end FROM subscriptions WHERE user_id = ?')
        .bind(userId)
        .first(),
      db.prepare('SELECT period, questions, audio FROM usage_counters WHERE user_id = ?').bind(userId).all(),
    ]);

  return {
    exportedAt: new Date(now()).toISOString(),
    profile: user,
    settings,
    notebooks: notebooks.results ?? [],
    sources: sources.results ?? [],
    messages: messages.results ?? [],
    notes: notes.results ?? [],
    subscription,
    usage: usage.results ?? [],
    note: 'Оригиналните файлове и аудио прегледите не са тук — свали ги от самото приложение.',
  };
}
