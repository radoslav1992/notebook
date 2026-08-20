/**
 * Слепва миграциите в един файл за поставяне в D1 Console на Cloudflare —
 * за настройка изцяло през браузъра, без терминал.
 *
 * Добавя и записите в `d1_migrations`, за да не се опита wrangler да пусне
 * същите миграции повторно (`ALTER TABLE ADD COLUMN` не е идемпотентен).
 *
 *   npm run console-schema
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'migrations');
// Нарочно НЕ е в migrations/: wrangler брои всеки .sql там за миграция, а този
// файл е всички миграции наведнъж. Стоеше ли вътре, `d1 migrations apply` се
// проваля с „duplicate column name“ при всяко пускане — и то накрая, след като
// истинските миграции вече са минали, тоест изглежда като счупен deploy.
const out = join(root, 'docs', 'console-schema.sql');

const files = readdirSync(dir)
  .filter((f) => /^\d+.*\.sql$/.test(f))
  .sort();

if (files.length === 0) throw new Error('няма миграции в ' + dir);

const parts = [
  `-- ─────────────────────────────────────────────────────────────────────────`,
  `-- Записки — цялата схема за поставяне в D1 Console.`,
  `--`,
  `-- ГЕНЕРИРАН ФАЙЛ. Не го редактирай — пипай миграциите и пусни:`,
  `--   npm run console-schema`,
  `--`,
  `-- За какво е: Cloudflare → Storage & Databases → D1 → zapiski → Console.`,
  `-- Постави всичко оттук и натисни Execute. Върши работата на`,
  `--   wrangler d1 migrations apply zapiski --remote`,
  `-- без да ти трябва терминал.`,
  `--`,
  `-- Съдържа: ${files.join(', ')}`,
  `-- ─────────────────────────────────────────────────────────────────────────`,
  ``,
  `-- Таблицата, с която wrangler помни какво вече е приложено. Пълни се накрая,`,
  `-- за да не се пуснат същите миграции втори път от командния ред.`,
  `CREATE TABLE IF NOT EXISTS d1_migrations (`,
  `  id         INTEGER PRIMARY KEY AUTOINCREMENT,`,
  `  name       TEXT UNIQUE,`,
  `  applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL`,
  `);`,
  ``,
];

for (const file of files) {
  parts.push(
    `-- ═══════════════════════════════════════════════════════════════════════`,
    `-- ${file}`,
    `-- ═══════════════════════════════════════════════════════════════════════`,
    ``,
    readFileSync(join(dir, file), 'utf8').trim(),
    ``,
  );
}

parts.push(
  `-- ═══════════════════════════════════════════════════════════════════════`,
  `-- Отбелязваме миграциите като приложени.`,
  `-- ═══════════════════════════════════════════════════════════════════════`,
  ``,
  ...files.map((f) => `INSERT OR IGNORE INTO d1_migrations (name) VALUES ('${f}');`),
  ``,
);

writeFileSync(out, parts.join('\n'));
// Списъкът на очакваните миграции, като код: middleware-ът го сравнява със
// записаните в d1_migrations и казва ЧЕТИМО кои липсват, вместо голо 500.
// Генериран е, за да няма как да изостане от папката — пуска се при всеки build.
const gen = [
  '// ГЕНЕРИРАН ФАЙЛ — не го редактирай. Пуска се от scripts/build-console-schema.mjs',
  '// при всеки build, за да съвпада винаги с папката migrations/.',
  'export const EXPECTED_MIGRATIONS: string[] = [',
  ...files.map((f) => `  '${f}',`),
  '];',
  '',
].join('\n');
writeFileSync(join(root, 'src', 'lib', 'migrations.gen.ts'), gen);

console.log(`docs/console-schema.sql ← ${files.join(', ')}`);
console.log(`src/lib/migrations.gen.ts ← ${files.length} migrations`);
