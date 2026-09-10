import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

loadEnv({ path: join(here, '..', '.env.e2e') });

/**
 * One clean database per RUN, not per test.
 *
 * Dropping the schema and re-migrating costs about fifteen seconds and buys the
 * property a gate needs: the same starting state every time. Per-test reset
 * would triple the runtime for no benefit, because the journeys are written to
 * be independent anyway - each registers its own buyer under a namespaced
 * email, exactly as the API e2e suite does.
 *
 * The DROP runs through `docker exec` rather than a local `psql`, which is not
 * on PATH on Windows and would make this step fail for half the people who run
 * it. The container is already required for the suite to work at all.
 *
 * NOT a Playwright `globalSetup`, deliberately. Playwright starts `webServer`
 * BEFORE globalSetup runs, so a reset there drops the schema underneath an API
 * that has already booted - which produced a screenful of "relation does not
 * exist" from the running server and, worse, left the boot probe racing the
 * drop. This runs from the `e2e` script instead, before Playwright starts at
 * all.
 */
function resetDatabase(): void {
  assertTestDatabase();

  run([
    'exec',
    'nexmarket-postgres-e2e',
    'psql',
    '-U',
    'postgres',
    '-d',
    'nexmarket_e2e',
    '-c',
    // BOTH schemas. Drizzle keeps its migration journal in `drizzle`, not
    // `public`, so dropping only public deletes every table while leaving the
    // bookkeeping saying all fifteen migrations are applied - and the next
    // `db:push` does nothing, reports success, and the seed then fails on
    // `relation "countries" does not exist`.
    'DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;',
  ]);

  // Re-grant, because DROP SCHEMA took the app role's privileges with it.
  run([
    'exec',
    'nexmarket-postgres-e2e',
    'psql',
    '-U',
    'postgres',
    '-d',
    'nexmarket_e2e',
    '-f',
    '/docker-entrypoint-initdb.d/01-app-role.sql',
  ]);

  runPnpm(['db:push']);
  runPnpm(['seed']);
}

/**
 * Refuses to run against anything but the test database.
 *
 * This function drops a schema. The cost of getting the target wrong is
 * somebody's development data, and the check that prevents it is three lines.
 */
function assertTestDatabase(): void {
  const url = process.env['DATABASE_MIGRATION_URL'] ?? '';
  if (!url.includes('5434') || !url.includes('nexmarket_e2e')) {
    throw new Error(
      `Refusing to drop a schema on ${url || '(unset)'} - the e2e suite runs ` +
        'only against nexmarket_e2e on port 5434. Check apps/e2e/.env.e2e.',
    );
  }
}

/**
 * `docker` is a real executable, so NO shell - and that is load-bearing on
 * Windows, where `shell: true` concatenates arguments unescaped and a SQL
 * string containing spaces arrives at psql as six separate arguments.
 */
function run(args: string[]): void {
  execFileSync('docker', args, { stdio: 'inherit', cwd: repoRoot, env: process.env });
}

/**
 * `pnpm` is a .cmd on Windows and needs a shell to resolve. Safe here only
 * because every argument is a single bare word.
 */
function runPnpm(args: string[]): void {
  execFileSync('pnpm', args, {
    stdio: 'inherit',
    cwd: repoRoot,
    env: process.env,
    shell: process.platform === 'win32',
  });
}

resetDatabase();
