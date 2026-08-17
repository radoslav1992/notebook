/* ── Покани в организация ──────────────────────────────────────────────────
 * Отделна таблица от `email_tokens`, защото тя иска `user_id`, а поканата се
 * праща на адрес, който още може да няма профил — точно обичайният случай при
 * училище, което кани класа си.
 *
 * Пази се само SHA-256 на токена, както при сесиите: открадната база не дава
 * готови покани.
 *
 * Поканата е вързана за адрес. Влезлият трябва да е с този имейл, за да я
 * приеме — иначе препратена връзка вкарва произволен човек в чужда организация,
 * а библиотеката е точно това, което не бива да се чете от външни.
 */
CREATE TABLE IF NOT EXISTS org_invites (
  token_hash TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email      TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'member',
  invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_org_invites_org ON org_invites(org_id);
CREATE INDEX IF NOT EXISTS idx_org_invites_email ON org_invites(email);
