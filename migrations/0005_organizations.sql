/* ── Организации и обща библиотека ─────────────────────────────────────────
 * Училище или катедра качва източници веднъж, а всеки член ги ползва в своите
 * тетрадки.
 *
 * Библиотеката НЕ е нов вид обект: тя е тетрадка с `kind='library'`, чийто
 * собственик е организацията. Така източниците, пасажите и вгражданията остават
 * точно както са — един запис, ползван от много тетрадки, без копия и без
 * повторно вграждане.
 *
 * Причината да не се въвежда отделна таблица „колекции“: извличането вече ще
 * стеснява само по `sourceId` (виж rag.ts). Тетрадката на източника спира да е
 * част от преградата, тоест няма какво да се преправя в индекса — метаданните
 * `sourceId` вече са индексирани и това стига.
 */

CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

/* Роли: owner|admin качват в библиотеката, member само чете от нея. */
CREATE TABLE IF NOT EXISTS org_members (
  org_id     TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON org_members(user_id);

/* Тетрадките на организацията са библиотеки; личните остават с org_id = NULL. */
ALTER TABLE notebooks ADD COLUMN org_id TEXT REFERENCES organizations(id) ON DELETE CASCADE;
ALTER TABLE notebooks ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal';
CREATE INDEX IF NOT EXISTS idx_notebooks_org ON notebooks(org_id, kind);

/*
 * Кои източници от библиотека са включени в дадена лична тетрадка.
 *
 * Изричен списък, а не „всичко от библиотеката“: човек избира какво чете, точно
 * както при своите източници. Каскадата е и от двете страни — махнат източник от
 * библиотеката изчезва от всички тетрадки, изтрита тетрадка не оставя връзки.
 */
CREATE TABLE IF NOT EXISTS notebook_library_sources (
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  source_id   TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (notebook_id, source_id)
);
CREATE INDEX IF NOT EXISTS idx_nls_source ON notebook_library_sources(source_id);
