import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * Eight seller organisations across distinct verticals, per success criterion S5.
 *
 * Deliberately generic. This is a universal marketplace, not a vertical one, and
 * the seed is the first place that claim is either true or obviously false.
 */
const ORGS = [
  {
    slug: 'acme-electronics',
    legalName: 'Acme Electronics Ltd',
    displayName: 'Acme Electronics',
    countryCode: 'BD',
    defaultCurrency: 'BDT',
  },
  {
    slug: 'meridian-fashion',
    legalName: 'Meridian Fashion House Ltd',
    displayName: 'Meridian Fashion',
    countryCode: 'BD',
    defaultCurrency: 'BDT',
  },
  {
    slug: 'northwind-home',
    legalName: 'Northwind Home and Living Ltd',
    displayName: 'Northwind Home',
    countryCode: 'BD',
    defaultCurrency: 'BDT',
  },
  {
    slug: 'olympus-sports',
    legalName: 'Olympus Sporting Goods Ltd',
    displayName: 'Olympus Sports',
    countryCode: 'IN',
    defaultCurrency: 'INR',
  },
  {
    slug: 'lumen-books',
    legalName: 'Lumen Books and Media Ltd',
    displayName: 'Lumen Books',
    countryCode: 'IN',
    defaultCurrency: 'INR',
  },
  {
    slug: 'verdant-grocers',
    legalName: 'Verdant Grocers Ltd',
    displayName: 'Verdant Grocers',
    countryCode: 'BD',
    defaultCurrency: 'BDT',
  },
  {
    slug: 'atlas-auto-parts',
    legalName: 'Atlas Auto Parts LLC',
    displayName: 'Atlas Auto Parts',
    countryCode: 'AE',
    defaultCurrency: 'AED',
  },
  {
    slug: 'cobalt-beauty',
    legalName: 'Cobalt Beauty Inc',
    displayName: 'Cobalt Beauty',
    countryCode: 'US',
    defaultCurrency: 'USD',
  },
] as const;

export async function seedOrganisations(db: Db): Promise<number> {
  await db
    .insert(schema.organisations)
    .values(ORGS.map((o) => ({ ...o, status: 'ACTIVE' as const })))
    .onConflictDoNothing({ target: schema.organisations.slug });
  return ORGS.length;
}
