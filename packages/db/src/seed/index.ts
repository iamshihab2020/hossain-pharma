import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema/index.js';
import { seedOrganisations } from './organisations.js';
import { seedReferenceData } from './reference-data.js';

type Db = NodePgDatabase<typeof schema>;

export type SeedSummary = {
  countries: number;
  currencies: number;
  organisations: number;
};

/**
 * Idempotent by construction: every insert uses onConflictDoNothing, so
 * `pnpm seed` is safe to re-run against a database that already has data.
 *
 * Later phases append their own seeders here in dependency order. Seed data
 * runs through this path rather than raw SQL dumps so it stays honest about
 * foreign keys and enum values.
 */
export async function seed(db: Db): Promise<SeedSummary> {
  const reference = await seedReferenceData(db);
  const organisations = await seedOrganisations(db);
  return { ...reference, organisations };
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (invokedDirectly) {
  const { db, closeDb } = await import('../client.js');
  try {
    const summary = await seed(db);
    console.log('Seeded:', summary);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
