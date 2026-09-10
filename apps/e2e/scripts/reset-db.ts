import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

loadEnv({ path: join(here, '..', '.env.e2e') });

/** Shared with `fixtures/actors.ts`. The demo password the seed also uses. */
const SELLER_EMAIL = 'e2e-seller@example.test';
const SELLER_ORG_SLUG = 'bengal-tech';

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

  // TRUNCATE, not DROP SCHEMA.
  //
  // Dropping and recreating the schema invalidates every object the running
  // API still holds a pooled connection against, and `reuseExistingServer`
  // means a server from the previous run can still be alive while this
  // executes. That produced a suite that passed, then failed three tests, then
  // passed again - including the smoke tests, which only ask /health.
  //
  // Truncating leaves the schema intact, so cached plans and pooled
  // connections stay valid, and it is faster. `db:push` below then does nothing
  // on a warm database and creates everything on a cold one.
  run([
    'exec',
    'nexmarket-postgres-e2e',
    'psql',
    '-U',
    'postgres',
    '-d',
    'nexmarket_e2e',
    '-c',
    `DO $$
     DECLARE t text;
     BEGIN
       FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
       LOOP
         EXECUTE format('TRUNCATE TABLE public.%I RESTART IDENTITY CASCADE', t);
       END LOOP;
     END $$;`,
  ]);

  runPnpm(['db:push']);
  runPnpm(['seed']);
  grantSellerAccess();
}

/**
 * A seller who owns exactly ONE organisation.
 *
 * The base seed's memberships cover acme-electronics, meridian-fashion and
 * northwind-home. The DEMO market - bengal-tech and its three rivals - has
 * nobody in it at all, so no one can sign in and fulfil an order placed against
 * it, which is the whole of the fulfilment journey.
 *
 * ONE organisation, deliberately: the seller console resolves the acting org as
 * the first one you belong to, so a user in four orgs would land on whichever
 * `/orgs/mine` happened to return first and the journey would fulfil a
 * different seller's order on a bad day.
 *
 * Done here rather than in the seed because the seed is shared - `seed.test.ts`
 * asserts its counts and the API suite reads its fixtures - and this database
 * is dropped in ninety seconds.
 *
 * Runs as the postgres SUPERUSER, which bypasses RLS outright. FORCE ROW LEVEL
 * SECURITY binds the table owner; it does not bind a superuser.
 */
function grantSellerAccess(): void {
  const password =
    '$argon2id$v=19$m=19456,t=2,p=1$thRx5qdwb4uDzOSyD10+Nw$' +
    'Hp0PmQOH1+1TFthjxCywCpcYHWtB9KTCWsbwCWWmCRc';

  run([
    'exec',
    'nexmarket-postgres-e2e',
    'psql',
    '-U',
    'postgres',
    '-d',
    'nexmarket_e2e',
    '-c',
    `INSERT INTO users (email, display_name, password_hash, platform_role)
     VALUES ('${SELLER_EMAIL}', 'E2E Seller', '${password}', 'BUYER')
     ON CONFLICT (email) DO NOTHING;
     INSERT INTO org_members (tenant_id, user_id, role)
     SELECT o.id, u.id, 'OWNER'
       FROM organisations o, users u
      WHERE o.slug = '${SELLER_ORG_SLUG}' AND u.email = '${SELLER_EMAIL}'
     ON CONFLICT DO NOTHING;`,
  ]);
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
