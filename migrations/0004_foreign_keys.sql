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
