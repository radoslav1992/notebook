/* ── Бизнес: платени места и общ пакет въпроси ─────────────────────────────
 * Организацията се продава по фактура, извън Stripe. Единственото, което
 * приложението трябва да знае, е колко места са платени: от тях се смята
 * общият месечен пакет въпроси (места × въпроси на място).
 *
 * `seats = 0` е обикновена организация — библиотеката работи, пакет няма.
 * Няма отделен флаг „платена“: местата са флагът.
 */
ALTER TABLE organizations ADD COLUMN seats INTEGER NOT NULL DEFAULT 0;

/* Общият брояч на организацията — огледало на usage_counters, но по org_id.
 * Отделна таблица, а не ред-фантом в usage_counters: чуждият първичен ключ
 * сочи users и всяка „организация като потребител“ би лъгала интеграцията. */
CREATE TABLE IF NOT EXISTS org_usage_counters (
  org_id    TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period    TEXT NOT NULL,
  questions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, period)
);
