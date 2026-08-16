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
-- Съдържа: 0001_init.sql, 0002_auth_billing.sql, 0003_hybrid_search.sql, 0004_foreign_keys.sql
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
-- 0003_hybrid_search.sql
-- ═══════════════════════════════════════════════════════════════════════

/* ── Търсене по думи ───────────────────────────────────────────────────────
 * Допълва Vectorize, вместо да го замества: смисълът и буквата хващат различни
 * неща, а „чл. 21“ и „Регламент 2016/679“ са буква.
 *
 * `prefix='2 3'` държи представките бързи — заявките са от вида „закон*“,
 * защото българският мени думите отзад (виж ftsQuery в src/lib/search.ts).
 * `remove_diacritics 0` не пипа кирилицата.
 *
 * Колоните UNINDEXED не влизат в индекса, но се пазят, за да може резултатът
 * да се стеснява до тетрадката и до избраните източници още в SQL.
 */
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  chunk_id    UNINDEXED,
  notebook_id UNINDEXED,
  source_id   UNINDEXED,
  text,
  tokenize='unicode61 remove_diacritics 0',
  prefix='2 3'
);

/* Пълни се от тригери, а не от кода.
 *
 * Пасажи се трият на четири места (източник, тетрадка, профил по GDPR) и на
 * пето — по каскада от users. Каскадата изобщо не минава през наш код, тоест
 * изричен DELETE в приложението няма как да я покрие и индексът щеше да пази
 * текста на изтрити профили. Тригерът лови и нея.
 */
CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (chunk_id, notebook_id, source_id, text)
  VALUES (new.id, new.notebook_id, new.source_id, new.text);
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
  DELETE FROM chunks_fts WHERE chunk_id = old.id;
END;

CREATE TRIGGER IF NOT EXISTS chunks_fts_au AFTER UPDATE OF text ON chunks BEGIN
  UPDATE chunks_fts SET text = new.text WHERE chunk_id = old.id;
END;

/* Вече качените източници — иначе търсенето по думи ги вижда като празни.
 * Безопасно е да се пусне пак: WHERE изключва вече вписаните.
 */
INSERT INTO chunks_fts (chunk_id, notebook_id, source_id, text)
SELECT c.id, c.notebook_id, c.source_id, c.text
FROM chunks c
WHERE c.id NOT IN (SELECT chunk_id FROM chunks_fts);

-- ═══════════════════════════════════════════════════════════════════════
-- 0004_foreign_keys.sql
-- ═══════════════════════════════════════════════════════════════════════

/* ── Външни ключове за таблиците от 0002 ───────────────────────────────────
 * Четирите таблици с `user_id` бяха без `REFERENCES`, тоест изтрит профил
 * оставяше сесии, токени, абонамент и броячи. Каскада няма откъде да дойде и
 * всичко се трие на ръка в `deleteUserRows` — списък, от който една пропусната
 * таблица значи остатък от изтрит профил.
 *
 * SQLite не може да добави ограничение към съществуваща таблица, затова
 * стандартният ход: нова таблица с ключа, преливане, размяна на имената.
 *
 * `rate_limits` остава както е нарочно — тя няма `user_id`, а ключ с имейла в
 * себе си (`rl_<имейл>_<ip>`), и продължава да се чисти изрично.
 *
 * Редът е важен: индексите се трият заедно с таблицата и се създават наново.
 */

/* ── sessions ────────────────────────────────────────────────────────────── */
CREATE TABLE sessions_new (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
/* Само редовете с жив профил: ако вече има осиротели, те не бива да минават
   нататък — точно тях миграцията чисти. */
INSERT INTO sessions_new (token_hash, user_id, created_at, expires_at, user_agent)
SELECT s.token_hash, s.user_id, s.created_at, s.expires_at, s.user_agent
FROM sessions s WHERE s.user_id IN (SELECT id FROM users);
DROP TABLE sessions;
ALTER TABLE sessions_new RENAME TO sessions;
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);

/* ── email_tokens ────────────────────────────────────────────────────────── */
CREATE TABLE email_tokens_new (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  email      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
INSERT INTO email_tokens_new (token_hash, user_id, kind, email, created_at, expires_at, used_at)
SELECT t.token_hash, t.user_id, t.kind, t.email, t.created_at, t.expires_at, t.used_at
FROM email_tokens t WHERE t.user_id IN (SELECT id FROM users);
DROP TABLE email_tokens;
ALTER TABLE email_tokens_new RENAME TO email_tokens;
CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id, kind);

/* ── subscriptions ───────────────────────────────────────────────────────── */
CREATE TABLE subscriptions_new (
  user_id                TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL DEFAULT 'free',
  status                 TEXT NOT NULL DEFAULT 'active',
  interval               TEXT NOT NULL DEFAULT 'month',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  current_period_end     INTEGER,
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  updated_at             INTEGER NOT NULL
);
INSERT INTO subscriptions_new
SELECT s.user_id, s.plan, s.status, s.interval, s.stripe_customer_id,
       s.stripe_subscription_id, s.current_period_end, s.cancel_at_period_end, s.updated_at
FROM subscriptions s WHERE s.user_id IN (SELECT id FROM users);
DROP TABLE subscriptions;
ALTER TABLE subscriptions_new RENAME TO subscriptions;
CREATE INDEX IF NOT EXISTS idx_subs_customer ON subscriptions(stripe_customer_id);

/* ── usage_counters ──────────────────────────────────────────────────────── */
CREATE TABLE usage_counters_new (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period    TEXT NOT NULL,
  questions INTEGER NOT NULL DEFAULT 0,
  audio     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, period)
);
INSERT INTO usage_counters_new (user_id, period, questions, audio)
SELECT u.user_id, u.period, u.questions, u.audio
FROM usage_counters u WHERE u.user_id IN (SELECT id FROM users);
DROP TABLE usage_counters;
ALTER TABLE usage_counters_new RENAME TO usage_counters;

-- ═══════════════════════════════════════════════════════════════════════
-- Отбелязваме миграциите като приложени.
-- ═══════════════════════════════════════════════════════════════════════

INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0001_init.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0002_auth_billing.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0003_hybrid_search.sql');
INSERT OR IGNORE INTO d1_migrations (name) VALUES ('0004_foreign_keys.sql');
