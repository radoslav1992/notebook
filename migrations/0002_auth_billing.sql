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
