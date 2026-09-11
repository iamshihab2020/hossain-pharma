import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type * as schema from '../schema/index.js';
import { seedCategories } from './categories.js';
import { seedDemoMarket, type DemoSummary } from './demo.js';
import { seedListings } from './listings.js';
import { seedLogistics, seedVariantMeasurements, type LogisticsSummary } from './logistics.js';
import { seedOrganisations } from './organisations.js';
import { seedProducts } from './products.js';
import { seedOrgMembers } from './org-members.js';
import { seedReferenceData } from './reference-data.js';
import { seedUsers } from './users.js';
import { seedSearchIndex } from './search.js';

type Db = NodePgDatabase<typeof schema>;

export type SeedSummary = DemoSummary &
  LogisticsSummary & {
    countries: number;
    currencies: number;
    organisations: number;
    users: number;
    orgMembers: number;
    categories: number;
    products: number;
    variants: number;
    warehouses: number;
    listings: number;
    searchDocuments: number;
    measuredVariants: number;
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
  // Order matters: memberships need both orgs and users to exist.
  const users = await seedUsers(db);
  const orgMembers = await seedOrgMembers(db);
  // Catalogue before listings: a listing points at a variant, and a variant
  // points at a product, which points at a category.
  const categories = await seedCategories(db);
  const { products, variants } = await seedProducts(db);
  const { warehouses, listings } = await seedListings(db);
  // Geography before anything that quotes shipping. Platform-owned and
  // tenant-free, so it needs no withTenant and depends on nothing above it
  // except the country codes in reference data.
  const logistics = await seedLogistics(db);
  // The demoable market: more sellers on one product than the acceptance
  // fixture needs, so the storefront has a real comparison to render.
  const demo = await seedDemoMarket(db);
  // AFTER the demo market, not merely after the catalogue. The demo seeds
  // variants of its own, and measuring before it runs leaves exactly the
  // products the storefront actually renders unquotable.
  const { measuredVariants } = await seedVariantMeasurements(db);
  // LAST, and it must be: a search document aggregates over the listings above,
  // so an index built before them describes a catalogue nobody is selling.
  const searchDocuments = await seedSearchIndex(db);
  return {
    ...reference,
    organisations,
    users,
    orgMembers,
    categories,
    products,
    variants,
    warehouses,
    listings,
    ...logistics,
    measuredVariants,
    ...demo,
    searchDocuments,
  };
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
