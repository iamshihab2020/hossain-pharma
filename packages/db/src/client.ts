import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { loadDbEnv } from './env.js';
import { makeWithTenant } from './tenant-context.js';
import * as schema from './schema/index.js';

const env = loadDbEnv();

/**
 * node-postgres over TCP.
 *
 * Chosen over Neon's HTTP driver because that driver cannot hold interactive
 * transactions (PRD 6.5), which both RLS tenant context and the ledger require.
 * The same driver serves local Docker Postgres and Neon, so no application code
 * path differs between development and deployment.
 *
 * Importing this module reads DATABASE_URL at load time. Test suites that spin up
 * their own database import the individual modules directly rather than the
 * package barrel, so they never touch this singleton.
 */
export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

export const db: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

/**
 * The production tenant-scoped transaction wrapper. This is the handle the rest
 * of the application uses; the raw `db` and `pool` above are banned outside this
 * package by a lint rule (PRD 6.4 criterion 2).
 */
export const withTenant = makeWithTenant(db);

export async function closeDb(): Promise<void> {
  await pool.end();
}
