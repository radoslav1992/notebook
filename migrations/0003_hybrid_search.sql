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
