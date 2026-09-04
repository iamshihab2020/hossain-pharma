import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
// Subpath imports, NOT the package barrel. The barrel loads client.ts, which
// reads DATABASE_URL at module load - and at import time here it is not set
// yet. These two subpaths carry no singleton and no environment read.
import * as schema from '@nexmarket/db/schema';
import { seed } from '@nexmarket/db/seed';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Pool } from 'pg';

let container: StartedPostgreSqlContainer | undefined;
let storageDir: string | undefined;

const require = createRequire(import.meta.url);
/**
 * The migrations live in @nexmarket/db, not here. Resolving through the package
 * entry point rather than a `../../../packages/db` relative path keeps this
 * working whether the suite runs from the repo root or from apps/api.
 */
function migrationsFolder(): string {
  return join(dirname(require.resolve('@nexmarket/db')), '..', 'migrations');
}

/**
 * Starts a real Postgres, migrates it, and points DATABASE_URL at it BEFORE any
 * test file is imported.
 *
 * The ordering matters: `@nexmarket/db`'s client.ts reads DATABASE_URL at module
 * load, and the health check opens a real connection. Setting the variable
 * inside a beforeAll would be too late, because importing AppModule has already
 * constructed the pool.
 *
 * DATABASE_URL points at nexmarket_app, NOT at the container's superuser. The
 * API must be exercised through the same NOBYPASSRLS role it uses in
 * production, or every tenancy assertion in this suite is meaningless - a
 * superuser walks past RLS even under FORCE. Migrations run as the owner,
 * which has the DDL rights the app role deliberately lacks.
 *
 * This is what makes `pnpm test` work on any machine with Docker, including CI,
 * without a separately provisioned database service.
 */
export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();

  const ownerPool = new Pool({ connectionString: container.getConnectionUri(), max: 1 });
  const ownerDb = drizzle(ownerPool);
  await ownerDb.execute(sql`CREATE ROLE nexmarket_app WITH LOGIN PASSWORD 'probe' NOBYPASSRLS`);
  await migrate(ownerDb, { migrationsFolder: migrationsFolder() });
  await ownerPool.end();

  const appUri = new URL(container.getConnectionUri());
  appUri.username = 'nexmarket_app';
  appUri.password = 'probe';
  process.env['DATABASE_URL'] = appUri.toString();

  /**
   * Seed AS THE APP ROLE, on its own pool, before the suite imports anything.
   *
   * The tenancy suite needs the PRD 5.1 fixture that only the seed produces -
   * one human holding OWNER in acme-electronics and STAFF in meridian-fashion.
   * Building that inline per test file would mean writing memberships around
   * RLS rather than through it, which is the exact mistake packages/db/src/seed
   * exists to demonstrate.
   *
   * Running it on nexmarket_app rather than the owner also makes the seed part
   * of what this suite proves: if a policy breaks, the seed fails here instead
   * of in production.
   */
  const appPool = new Pool({ connectionString: appUri.toString(), max: 1 });
  await seed(drizzle(appPool, { schema }));
  await appPool.end();

  // The env schema requires signing secrets at boot (PRD 13), so the suite must
  // supply them for the same reason it supplies DATABASE_URL: AppModule
  // validates the environment at module load, before any test runs. These are
  // throwaway values with no meaning outside this process - `??=` so a CI job
  // that sets its own wins.
  process.env['JWT_ACCESS_SECRET'] ??= 'test-access-secret-not-used-anywhere-32';
  process.env['JWT_REFRESH_SECRET'] ??= 'test-refresh-secret-not-used-anywher-32';

  // Documents land in a throwaway directory, not in the repo. The default
  // (.nexmarket/uploads, relative to cwd) would leave test uploads inside
  // apps/api and eventually inside someone's commit.
  storageDir = await mkdtemp(join(tmpdir(), 'nexmarket-test-uploads-'));
  process.env['FILE_STORAGE_DIR'] = storageDir;
}

export async function teardown(): Promise<void> {
  await container?.stop();
  if (storageDir !== undefined) await rm(storageDir, { recursive: true, force: true });
}
