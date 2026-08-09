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
const out = join(dir, 'console-schema.sql');

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
console.log(`migrations/console-schema.sql ← ${files.join(', ')}`);
