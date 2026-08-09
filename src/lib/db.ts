import { newId, now } from './ids';
import type {
  AudioFormat,
  AudioOverview,
  AudioStatus,
  Citation,
  Message,
  Note,
  NoteKind,
  Notebook,
  Source,
  SourceKind,
  SourceStatus,
} from './types';

/* ------------------------------- row mappers ------------------------------ */

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (v == null ? 0 : Number(v));

function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function toNotebook(r: Row): Notebook {
  return {
    id: str(r.id),
    ownerId: str(r.owner_id),
    title: str(r.title),
    emoji: str(r.emoji) || '📓',
    description: strOrNull(r.description),
    storeName: strOrNull(r.store_name),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toSource(r: Row): Source {
  return {
    id: str(r.id),
    notebookId: str(r.notebook_id),
    title: str(r.title),
    kind: str(r.kind) as SourceKind,
    mimeType: strOrNull(r.mime_type),
    sizeBytes: num(r.size_bytes),
    originUrl: strOrNull(r.origin_url),
    status: str(r.status) as SourceStatus,
    error: strOrNull(r.error),
    summary: strOrNull(r.summary),
    topics: parseJson<string[]>(r.topics, []),
    preview: strOrNull(r.preview),
    createdAt: num(r.created_at),
  };
}

function toMessage(r: Row): Message {
  return {
    id: str(r.id),
    notebookId: str(r.notebook_id),
    role: str(r.role) as 'user' | 'assistant',
    content: str(r.content),
    citations: parseJson<Citation[]>(r.citations, []),
    createdAt: num(r.created_at),
  };
}

function toNote(r: Row): Note {
  return {
    id: str(r.id),
    notebookId: str(r.notebook_id),
    title: str(r.title),
    content: str(r.content),
    kind: str(r.kind) as NoteKind,
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toAudio(r: Row): AudioOverview {
  return {
    id: str(r.id),
    notebookId: str(r.notebook_id),
    status: str(r.status) as AudioStatus,
    format: str(r.format) as AudioFormat,
    focus: strOrNull(r.focus),
    script: strOrNull(r.script),
    durationMs: r.duration_ms == null ? null : num(r.duration_ms),
    error: strOrNull(r.error),
    createdAt: num(r.created_at),
  };
}

/* -------------------------------- notebooks ------------------------------- */

export async function listNotebooks(db: D1Database, ownerId: string): Promise<Notebook[]> {
  const { results } = await db
    .prepare('SELECT * FROM notebooks WHERE owner_id = ? ORDER BY updated_at DESC')
    .bind(ownerId)
    .all<Row>();
  return (results ?? []).map(toNotebook);
}

export async function countSourcesByNotebook(
  db: D1Database,
  notebookIds: string[],
): Promise<Record<string, number>> {
  if (!notebookIds.length) return {};
  const placeholders = notebookIds.map(() => '?').join(',');
  const { results } = await db
    .prepare(
      `SELECT notebook_id, COUNT(*) AS n FROM sources WHERE notebook_id IN (${placeholders}) GROUP BY notebook_id`,
    )
    .bind(...notebookIds)
    .all<Row>();
  const out: Record<string, number> = {};
  for (const r of results ?? []) out[str(r.notebook_id)] = num(r.n);
  return out;
}

export async function createNotebook(
  db: D1Database,
  input: { ownerId: string; title?: string; emoji?: string },
): Promise<Notebook> {
  const ts = now();
  const nb: Notebook = {
    id: newId('nb'),
    ownerId: input.ownerId,
    title: input.title?.trim() || 'Untitled notebook',
    emoji: input.emoji || '📓',
    description: null,
    storeName: null,
    createdAt: ts,
    updatedAt: ts,
  };
  await db
    .prepare(
      `INSERT INTO notebooks (id, owner_id, title, emoji, description, store_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)`,
    )
    .bind(nb.id, nb.ownerId, nb.title, nb.emoji, ts, ts)
    .run();
  return nb;
}

export async function getNotebook(
  db: D1Database,
  id: string,
  ownerId: string,
): Promise<Notebook | null> {
  const row = await db
    .prepare('SELECT * FROM notebooks WHERE id = ? AND owner_id = ?')
    .bind(id, ownerId)
    .first<Row>();
  return row ? toNotebook(row) : null;
}

export async function updateNotebook(
  db: D1Database,
  id: string,
  patch: Partial<Pick<Notebook, 'title' | 'emoji' | 'description' | 'storeName'>>,
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  const map: Record<string, string> = {
    title: 'title',
    emoji: 'emoji',
    description: 'description',
    storeName: 'store_name',
  };
  for (const [key, column] of Object.entries(map)) {
    const value = patch[key as keyof typeof patch];
    if (value !== undefined) {
      sets.push(`${column} = ?`);
      args.push(value);
    }
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(now(), id);
  await db.prepare(`UPDATE notebooks SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
}

export async function touchNotebook(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE notebooks SET updated_at = ? WHERE id = ?').bind(now(), id).run();
}

export async function deleteNotebook(db: D1Database, id: string): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM sources WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM messages WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM notes WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM audio_overviews WHERE notebook_id = ?').bind(id),
    db.prepare('DELETE FROM notebooks WHERE id = ?').bind(id),
  ]);
}

/* --------------------------------- sources -------------------------------- */

export async function listSources(db: D1Database, notebookId: string): Promise<Source[]> {
  const { results } = await db
    .prepare('SELECT * FROM sources WHERE notebook_id = ? ORDER BY created_at ASC')
    .bind(notebookId)
    .all<Row>();
  return (results ?? []).map(toSource);
}

export async function getSource(db: D1Database, id: string): Promise<
  (Source & { docName: string | null; r2Key: string | null; operationName: string | null }) | null
> {
  const row = await db.prepare('SELECT * FROM sources WHERE id = ?').bind(id).first<Row>();
  if (!row) return null;
  return {
    ...toSource(row),
    docName: strOrNull(row.doc_name),
    r2Key: strOrNull(row.r2_key),
    operationName: strOrNull(row.operation_name),
  };
}

export async function insertSource(
  db: D1Database,
  input: {
    id: string;
    notebookId: string;
    title: string;
    kind: SourceKind;
    mimeType?: string | null;
    sizeBytes?: number;
    r2Key?: string | null;
    originUrl?: string | null;
    preview?: string | null;
  },
): Promise<void> {
  const ts = now();
  await db
    .prepare(
      `INSERT INTO sources
         (id, notebook_id, title, kind, mime_type, size_bytes, r2_key, origin_url,
          status, error, doc_name, operation_name, summary, topics, preview, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'indexing', NULL, NULL, NULL, NULL, NULL, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.notebookId,
      input.title,
      input.kind,
      input.mimeType ?? null,
      input.sizeBytes ?? 0,
      input.r2Key ?? null,
      input.originUrl ?? null,
      input.preview ?? null,
      ts,
      ts,
    )
    .run();
}

export async function updateSource(
  db: D1Database,
  id: string,
  patch: {
    status?: SourceStatus;
    error?: string | null;
    docName?: string | null;
    operationName?: string | null;
    summary?: string | null;
    topics?: string[] | null;
    title?: string;
    preview?: string | null;
  },
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.status !== undefined) push('status', patch.status);
  if (patch.error !== undefined) push('error', patch.error);
  if (patch.docName !== undefined) push('doc_name', patch.docName);
  if (patch.operationName !== undefined) push('operation_name', patch.operationName);
  if (patch.summary !== undefined) push('summary', patch.summary);
  if (patch.topics !== undefined) push('topics', patch.topics ? JSON.stringify(patch.topics) : null);
  if (patch.title !== undefined) push('title', patch.title);
  if (patch.preview !== undefined) push('preview', patch.preview);
  if (!sets.length) return;
  push('updated_at', now());
  args.push(id);
  await db.prepare(`UPDATE sources SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
}

export async function deleteSource(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM sources WHERE id = ?').bind(id).run();
}

/* -------------------------------- messages -------------------------------- */

export async function listMessages(db: D1Database, notebookId: string): Promise<Message[]> {
  const { results } = await db
    .prepare('SELECT * FROM messages WHERE notebook_id = ? ORDER BY created_at ASC')
    .bind(notebookId)
    .all<Row>();
  return (results ?? []).map(toMessage);
}

export async function insertMessage(
  db: D1Database,
  input: {
    id?: string;
    notebookId: string;
    role: 'user' | 'assistant';
    content: string;
    citations?: Citation[];
  },
): Promise<Message> {
  const msg: Message = {
    id: input.id ?? newId('m'),
    notebookId: input.notebookId,
    role: input.role,
    content: input.content,
    citations: input.citations ?? [],
    createdAt: now(),
  };
  await db
    .prepare(
      `INSERT INTO messages (id, notebook_id, role, content, citations, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      msg.id,
      msg.notebookId,
      msg.role,
      msg.content,
      JSON.stringify(msg.citations),
      msg.createdAt,
    )
    .run();
  return msg;
}

export async function clearMessages(db: D1Database, notebookId: string): Promise<void> {
  await db.prepare('DELETE FROM messages WHERE notebook_id = ?').bind(notebookId).run();
}

/* ---------------------------------- notes --------------------------------- */

export async function listNotes(db: D1Database, notebookId: string): Promise<Note[]> {
  const { results } = await db
    .prepare('SELECT * FROM notes WHERE notebook_id = ? ORDER BY created_at DESC')
    .bind(notebookId)
    .all<Row>();
  return (results ?? []).map(toNote);
}

export async function insertNote(
  db: D1Database,
  input: { notebookId: string; title: string; content: string; kind?: NoteKind },
): Promise<Note> {
  const ts = now();
  const note: Note = {
    id: newId('n'),
    notebookId: input.notebookId,
    title: input.title,
    content: input.content,
    kind: input.kind ?? 'note',
    createdAt: ts,
    updatedAt: ts,
  };
  await db
    .prepare(
      `INSERT INTO notes (id, notebook_id, title, content, kind, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(note.id, note.notebookId, note.title, note.content, note.kind, ts, ts)
    .run();
  return note;
}

export async function updateNote(
  db: D1Database,
  id: string,
  patch: { title?: string; content?: string },
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    args.push(patch.title);
  }
  if (patch.content !== undefined) {
    sets.push('content = ?');
    args.push(patch.content);
  }
  if (!sets.length) return;
  sets.push('updated_at = ?');
  args.push(now(), id);
  await db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
}

export async function deleteNote(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM notes WHERE id = ?').bind(id).run();
}

/* ----------------------------- audio overviews ---------------------------- */

export async function listAudio(db: D1Database, notebookId: string): Promise<AudioOverview[]> {
  const { results } = await db
    .prepare('SELECT * FROM audio_overviews WHERE notebook_id = ? ORDER BY created_at DESC')
    .bind(notebookId)
    .all<Row>();
  return (results ?? []).map(toAudio);
}

export async function getAudio(db: D1Database, id: string): Promise<
  (AudioOverview & { r2Key: string | null }) | null
> {
  const row = await db.prepare('SELECT * FROM audio_overviews WHERE id = ?').bind(id).first<Row>();
  if (!row) return null;
  return { ...toAudio(row), r2Key: strOrNull(row.r2_key) };
}

export async function insertAudio(
  db: D1Database,
  input: { notebookId: string; format: AudioFormat; focus?: string | null },
): Promise<AudioOverview> {
  const ts = now();
  const job: AudioOverview = {
    id: newId('a'),
    notebookId: input.notebookId,
    status: 'scripting',
    format: input.format,
    focus: input.focus ?? null,
    script: null,
    durationMs: null,
    error: null,
    createdAt: ts,
  };
  await db
    .prepare(
      `INSERT INTO audio_overviews
         (id, notebook_id, status, format, focus, script, r2_key, duration_ms, error, created_at, updated_at)
       VALUES (?, ?, 'scripting', ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .bind(job.id, job.notebookId, job.format, job.focus, ts, ts)
    .run();
  return job;
}

export async function updateAudio(
  db: D1Database,
  id: string,
  patch: {
    status?: AudioStatus;
    script?: string | null;
    r2Key?: string | null;
    durationMs?: number | null;
    error?: string | null;
  },
): Promise<void> {
  const sets: string[] = [];
  const args: unknown[] = [];
  const push = (col: string, val: unknown) => {
    sets.push(`${col} = ?`);
    args.push(val);
  };
  if (patch.status !== undefined) push('status', patch.status);
  if (patch.script !== undefined) push('script', patch.script);
  if (patch.r2Key !== undefined) push('r2_key', patch.r2Key);
  if (patch.durationMs !== undefined) push('duration_ms', patch.durationMs);
  if (patch.error !== undefined) push('error', patch.error);
  if (!sets.length) return;
  push('updated_at', now());
  args.push(id);
  await db.prepare(`UPDATE audio_overviews SET ${sets.join(', ')} WHERE id = ?`).bind(...args).run();
}

export async function deleteAudio(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM audio_overviews WHERE id = ?').bind(id).run();
}
