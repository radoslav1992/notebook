/**
 * Грешките от Vectorize, преведени.
 *
 * Има точно един начин да се сбърка сериозно: `EMBED_MODEL` да не съвпада с
 * ширината на индекса. Индекс не се преоразмерява, а моделите дават различни
 * ширини (1536 за `gemini-embedding-001`, 1024 за `@cf/baai/bge-m3`), тоест
 * смяната на модела от dashboard-а изглежда безобидна и чупи търсенето.
 *
 * Заявката се проваля от само себе си — важното е съобщението да казва защо и
 * какво се прави, вместо суровия текст на Vectorize.
 */

/** Несъвпадение между ширината на вектора и индекса. */
export function isDimensionMismatch(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err);
  return /dimension/i.test(raw);
}

export function vectorError(err: unknown, dimensions: number): Error {
  const raw = err instanceof Error ? err.message : String(err);
  if (!isDimensionMismatch(err)) return err instanceof Error ? err : new Error(raw);

  return new Error(
    `Моделът за вграждане дава ${dimensions} измерения, а Vectorize индексът очаква друго число. ` +
      'Ширината на съществуващ индекс не се мени: или върни предишния EMBED_MODEL, ' +
      `или направи нов индекс с ${dimensions} измерения, смени \`index_name\` в wrangler.jsonc ` +
      'и качи източниците наново. Виж docs/models.md. Vectorize отговори: ' +
      raw.slice(0, 200),
  );
}
