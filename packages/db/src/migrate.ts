import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Migrations connect as the OWNER, not as nexmarket_app: they need DDL rights the
 * application role deliberately does not have.
 *
 * Exposed as `pnpm db:push` at the repo root. That name is kept because it is
 * the documented one-liner in the README and success criterion S4, but it runs
 * migrations rather than `drizzle-kit push`: push diffs the schema and cannot
 * express CREATE POLICY, FORCE ROW LEVEL SECURITY, or role grants. See
 * docs/architecture/0005.
 */
export async function runMigrations(): Promise<void> {
  const url = process.env.DATABASE_MIGRATION_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_MIGRATION_URL or DATABASE_URL must be set to run migrations');
  }

  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: join(here, '..', 'migrations') });
    console.log('Migrations applied.');
  } finally {
    await pool.end();
  }
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (invokedDirectly) {
  runMigrations().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
