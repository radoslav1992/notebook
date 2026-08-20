/**
 * Проверка, че базата е в крак с кода — ПРЕДИ кодът да гръмне върху нея.
 *
 * Deploy изпревари миграция три пъти: кодът чете колона, която я няма, `/app`
 * отговаря с голо 500 и по нищо не личи защо. Симптомът дори подвежда — гърми
 * само това, което пипа новата колона, тоест изглежда като счупена функция, а не
 * като липсваща миграция.
 *
 * Затова: списъкът с очакваните миграции се генерира при build (няма как да
 * изостане от папката), а тук се сравнява със записаното в `d1_migrations`. При
 * разлика заявката получава 503 с ясен текст кои липсват, вместо 500 без следа.
 */

import { EXPECTED_MIGRATIONS } from './migrations.gen';

/** Кои очаквани миграции ги няма сред приложените. Чиста функция — има тест. */
export function missingMigrations(expected: string[], applied: string[]): string[] {
  const done = new Set(applied);
  return expected.filter((name) => !done.has(name));
}

/**
 * Резултатът се помни: наред ли е веднъж, не се пита повече (миграции не се
 * „отприлагат“), а при липси се проверява наново най-много на половин минута —
 * за да се оправи само, щом миграциите се пуснат, без нов deploy.
 */
let healthy = false;
let lastCheck = 0;
let lastMissing: string[] = [];

const RECHECK_MS = 30_000;

export async function checkMigrations(db: D1Database): Promise<string[]> {
  if (healthy) return [];
  const at = Date.now();
  if (at - lastCheck < RECHECK_MS) return lastMissing;
  lastCheck = at;

  let applied: string[] = [];
  try {
    const { results } = await db
      .prepare('SELECT name FROM d1_migrations')
      .all<{ name: string }>();
    applied = (results ?? []).map((r) => r.name);
  } catch {
    // Няма дори таблицата на миграциите — прясна база, нищо не е пускано.
    applied = [];
  }

  lastMissing = missingMigrations(EXPECTED_MIGRATIONS, applied);
  if (lastMissing.length === 0) {
    healthy = true;
  } else {
    console.error('[zapiski:migrations] базата е зад кода', { missing: lastMissing });
  }
  return lastMissing;
}

/** Текстът, който вижда заявката — казва какво да се направи, не само че е зле. */
export function migrationsMessage(missing: string[]): string {
  return (
    `Базата е зад кода: липсват миграции ${missing.join(', ')}. ` +
    `Пусни "npm run db:migrate" или ги приложи през D1 Console, после запиши имената им в d1_migrations.`
  );
}
