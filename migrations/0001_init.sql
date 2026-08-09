-- NotebookLM clone — initial schema

CREATE TABLE IF NOT EXISTS notebooks (
  id           TEXT PRIMARY KEY,
  owner_id     TEXT NOT NULL,
  title        TEXT NOT NULL,
  emoji        TEXT NOT NULL DEFAULT '📓',
  description  TEXT,
  -- Gemini File Search store backing this notebook: "fileSearchStores/xxxx"
  store_name   TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notebooks_owner ON notebooks (owner_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sources (
  id             TEXT PRIMARY KEY,
  notebook_id    TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  kind           TEXT NOT NULL,               -- file | text | url | youtube
  mime_type      TEXT,
  size_bytes     INTEGER NOT NULL DEFAULT 0,
  r2_key         TEXT,
  origin_url     TEXT,
  status         TEXT NOT NULL DEFAULT 'indexing', -- indexing | ready | error
  error          TEXT,
  doc_name       TEXT,                        -- fileSearchStores/x/documents/y
  operation_name TEXT,
  summary        TEXT,
  topics         TEXT,                        -- JSON array of strings
  preview        TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sources_notebook ON sources (notebook_id, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  notebook_id  TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  role         TEXT NOT NULL,                 -- user | assistant
  content      TEXT NOT NULL,
  citations    TEXT,                          -- JSON array of Citation
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_notebook ON messages (notebook_id, created_at);

CREATE TABLE IF NOT EXISTS notes (
  id           TEXT PRIMARY KEY,
  notebook_id  TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  content      TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'note',  -- note | study_guide | briefing | faq | timeline | mindmap | saved_answer
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes (notebook_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audio_overviews (
  id           TEXT PRIMARY KEY,
  notebook_id  TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  status       TEXT NOT NULL,                 -- scripting | synthesizing | ready | error
  format       TEXT NOT NULL DEFAULT 'deep_dive',
  focus        TEXT,
  script       TEXT,
  r2_key       TEXT,
  duration_ms  INTEGER,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audio_notebook ON audio_overviews (notebook_id, created_at DESC);
