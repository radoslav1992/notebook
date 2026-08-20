/* ── Общи набори ───────────────────────────────────────────────────────────
 * Набор = тетрадка с `kind='dataset'` и без `org_id`. Същият избор като при
 * библиотеката на организация, по същата причина: източниците, пасажите и
 * вгражданията остават както са, а качването минава през СЪЩИЯ маршрут — нула
 * нова логика за PDF-и, линкове и обработка.
 *
 * Има и второ следствие, което спестява цяла миграция на индекса: понеже наборът
 * Е тетрадка, метаданните `notebookId` във Vectorize вече СА идентификаторът на
 * набора. Не трябва ново поле, а метаданните не важат назад.
 */
CREATE TABLE IF NOT EXISTS datasets_meta (
  notebook_id  TEXT PRIMARY KEY REFERENCES notebooks(id) ON DELETE CASCADE,
  blurb        TEXT NOT NULL DEFAULT '',
  /* За кои употреби е подходящ: „study,legal“. Празно значи „за всички“. */
  use_cases    TEXT NOT NULL DEFAULT '',
  /* Непубликуван набор се вижда само от администратор — качването и проверката
     стават на живо, а не в отделна среда. */
  published_at INTEGER
);

/* Кой има достъп. Отделно от `org_members`: наборът се купува, не се членува. */
CREATE TABLE IF NOT EXISTS dataset_grants (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  granted_at INTEGER NOT NULL,
  /* NULL значи безсрочен. */
  expires_at INTEGER,
  PRIMARY KEY (user_id, dataset_id)
);
CREATE INDEX IF NOT EXISTS idx_dataset_grants_ds ON dataset_grants(dataset_id);

/* Включен ли е наборът в тази тетрадка. Един ключ за целия набор, не за всеки
   източник в него: наборите са стотици документи, а панелът стои на отметки. */
CREATE TABLE IF NOT EXISTS notebook_datasets (
  notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  dataset_id  TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (notebook_id, dataset_id)
);
CREATE INDEX IF NOT EXISTS idx_notebook_datasets_ds ON notebook_datasets(dataset_id);

/* Изтеглена редакция. Обновяването на закон е НОВ източник, а старият се маркира
 * тук — така цитат от стар разговор още сочи текста, който човекът е чел. Иначе
 * цитатите започват да лъжат назад във времето, което е по-лошо от липсващ набор.
 */
ALTER TABLE sources ADD COLUMN retired_at INTEGER;
