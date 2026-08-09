-- Записки — начална схема
-- wrangler d1 migrations apply zapiski --local   (или --remote)

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL DEFAULT 'Радослав',
  initials      TEXT NOT NULL DEFAULT 'РД',
  created_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  user_id           TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  response_language TEXT    NOT NULL DEFAULT 'bg',
  offline_mode      INTEGER NOT NULL DEFAULT 1,
  chat_model        TEXT    NOT NULL DEFAULT 'gemini-2.5-flash',
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS notebooks (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       TEXT NOT NULL DEFAULT '📓',
  title       TEXT NOT NULL,
  blurb       TEXT NOT NULL DEFAULT '',
  -- Google File Search store, when RAG_BACKEND=gemini.
  store_name  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sources (
  id          TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,          -- 1-базиран; ползва се в цитатите („3 · стр. 5“)
  kind        TEXT NOT NULL,             -- PDF | DOC | WEB | YT | TXT | AUD
  name        TEXT NOT NULL,
  sub         TEXT NOT NULL DEFAULT '',
  origin_url  TEXT,
  r2_key      TEXT,
  byte_size   INTEGER NOT NULL DEFAULT 0,
  page_count  INTEGER NOT NULL DEFAULT 0,
  char_count  INTEGER NOT NULL DEFAULT 0,
  selected    INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'pending',  -- pending | indexing | ready | error
  error       TEXT,
  doc_name    TEXT,                      -- File Search document name, when RAG_BACKEND=gemini
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_notebook ON sources(notebook_id, ordinal);

CREATE TABLE IF NOT EXISTS chunks (
  id          TEXT PRIMARY KEY,          -- също и Vectorize vector id
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,
  page        INTEGER,                   -- страница / раздел / времеви код
  locator     TEXT NOT NULL DEFAULT '',  -- човешки четимо: „стр. 12“, „34:12“, „раздел 2“
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_chunks_notebook ON chunks(notebook_id);

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,             -- user | ai
  text        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_notebook ON messages(notebook_id, created_at);

CREATE TABLE IF NOT EXISTS citations (
  id          TEXT PRIMARY KEY,
  message_id  TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  ordinal     INTEGER NOT NULL,          -- редът на чипа в отговора
  source_id   TEXT,
  label       TEXT NOT NULL,             -- „1 · Зелена сделка, стр. 12“
  locator     TEXT NOT NULL DEFAULT '',
  snippet     TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_citations_message ON citations(message_id, ordinal);

CREATE TABLE IF NOT EXISTS notes (
  id          TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'note',  -- note | study_guide | timeline | briefing | exam
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id, created_at DESC);

CREATE TABLE IF NOT EXISTS studio_jobs (
  id           TEXT PRIMARY KEY,
  notebook_id  TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,            -- audio | mindmap | note
  status       TEXT NOT NULL,            -- queued | running | done | error
  step         TEXT NOT NULL DEFAULT '',
  progress     INTEGER NOT NULL DEFAULT 0,
  result_json  TEXT,
  r2_key       TEXT,
  duration_s   INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_notebook ON studio_jobs(notebook_id, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS mindmaps (
  notebook_id TEXT PRIMARY KEY REFERENCES notebooks(id) ON DELETE CASCADE,
  json        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
