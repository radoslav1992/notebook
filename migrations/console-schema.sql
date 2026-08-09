-- ─────────────────────────────────────────────────────────────────────────
-- Записки — цялата схема за поставяне в D1 Console.
--
-- ГЕНЕРИРАН ФАЙЛ. Не го редактирай — пипай миграциите и пусни:
--   npm run console-schema
--
-- За какво е: Cloudflare → Storage & Databases → D1 → zapiski → Console.
-- Постави всичко оттук и натисни Execute. Върши работата на
--   wrangler d1 migrations apply zapiski --remote
-- без да ти трябва терминал.
--
-- Съдържа: 0001_init.sql, 0002_auth_billing.sql
-- ─────────────────────────────────────────────────────────────────────────

-- Таблицата, с която wrangler помни какво вече е приложено. Пълни се накрая,
-- за да не се пуснат същите миграции втори път от командния ред.
CREATE TABLE IF NOT EXISTS d1_migrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT UNIQUE,
  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════
-- 0001_init.sql
-- ═══════════════════════════════════════════════════════════════════════

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

-- ═══════════════════════════════════════════════════════════════════════
-- 0002_auth_billing.sql
-- ═══════════════════════════════════════════════════════════════════════

-- Вход и абонаменти.
-- wrangler d1 migrations apply zapiski --local   (или --remote)

/* ── Потребители ───────────────────────────────────────────────────────────
 * Анонимните профили остават: човек може да пробва приложението без вход и
 * после да си вземе тетрадките, като се регистрира.
 */
ALTER TABLE users ADD COLUMN email TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN google_id TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 1;

-- Имейлите се пазят в долен регистър, за да няма два профила с един адрес.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_id) WHERE google_id IS NOT NULL;

/* ── Сесии ─────────────────────────────────────────────────────────────────
 * Пази се само SHA-256 на токена: изтекла база не дава готови сесии.
 */
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

/* ── Еднократни връзки: потвърждаване на имейл и нова парола ─────────────── */
CREATE TABLE IF NOT EXISTS email_tokens (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,            -- verify | reset
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, kind);

/* ── Абонаменти ────────────────────────────────────────────────────────────
 * Липсващ ред = безплатен план. Истината за плащането е у Stripe; тук държим
 * само каквото трябва, за да решим какво е разрешено.
 */
CREATE TABLE IF NOT EXISTS subscriptions (
  user_id              TEXT PRIMARY KEY,
  plan                 TEXT NOT NULL DEFAULT 'free',   -- free | plus | pro
  status               TEXT NOT NULL DEFAULT 'active',  -- active | trialing | past_due | canceled | incomplete
  interval             TEXT NOT NULL DEFAULT 'month',   -- month | year
  stripe_customer_id   TEXT,
  stripe_subscription_id TEXT,
  current_period_end   INTEGER,
  cancel_at_period_end INTEGER NOT NULL DEFAULT 0,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(stripe_customer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subs_subscription
  ON subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

/* ── Месечно потребление ───────────────────────────────────────────────────
 * `period` е „2026-08“. Отделен ред на месец, за да няма нужда от нулиране.
 */
CREATE TABLE IF NOT EXISTS usage_counters (
  user_id    TEXT NOT NULL,
  period     TEXT NOT NULL,
  questions  INTEGER NOT NULL DEFAULT 0,
  audio      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);

/* ── Ограничаване на опитите за вход ──────────────────────────────────────
 * Ключът е „имейл + адрес“, за да не блокираме цяла мрежа заради един човек.
 */
CREATE TABLE IF NOT EXISTS rate_limits (
  key          TEXT PRIMARY KEY,
  count        INTEGER NOT NULL DEFAULT 0,
  window_start INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_window ON rate_limits(window_start);

/* ── Обработени събития от Stripe ──────────────────────────────────────────
 * Stripe праща едно събитие повече от веднъж; това го прави безвредно.
 */
CREATE TABLE IF NOT EXISTS stripe_events (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);

-- ═══════════════════════════════════════════════════════════════════════
-- Отбелязваме миграциите като приложени.
-- ═══════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_init.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_auth_billing.sql');
