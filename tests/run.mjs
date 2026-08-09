/**
 * Пуска всички тестове. Тестовете, които говорят с Gemini, ползват макета
 * от tests/mock-gemini.mjs — никога истинското API.
 *
 *   npm test
 */
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = 8788;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit', cwd: here, ...opts });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} → exit ${code}`))));
    child.on('error', reject);
  });
}

async function waitForMock(timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/__calls`);
      if (res.ok) return;
    } catch {
      /* още не слуша */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('макетът на Gemini не се вдигна');
}

console.log('→ подготвям тестовите файлове');
await run(process.execPath, [join(here, 'fixtures/build.mjs')]);

console.log('\n→ вдигам макета на Gemini');
const mock = spawn(process.execPath, [join(here, 'mock-gemini.mjs')], {
  cwd: here,
  stdio: ['ignore', 'ignore', 'inherit'],
  env: { ...process.env, MOCK_PORT: String(PORT) },
});
let failed = null;
try {
  await waitForMock();
  for (const file of ['logic.test.mjs', 'access.test.mjs', 'auth.test.mjs', 'limits.test.mjs', 'docx.test.mjs', 'pdf.test.mjs', 'rag.test.mjs']) {
    console.log(`\n──────── ${file} ────────`);
    await run('npx', ['tsx', '--import', join(here, 'loader.mjs'), join(here, file)]);
  }
} catch (err) {
  failed = err;
} finally {
  mock.kill();
}

if (failed) {
  console.error('\n✘ ' + failed.message);
  process.exit(1);
}
console.log('\n✓ всички тестове минаха');
