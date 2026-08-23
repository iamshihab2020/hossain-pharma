import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

const COUNTRIES = [
  { code: 'BD', name: 'Bangladesh', dialCode: '+880' },
  { code: 'IN', name: 'India', dialCode: '+91' },
  { code: 'US', name: 'United States', dialCode: '+1' },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44' },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971' },
] as const;

const CURRENCIES = [
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: 'Tk', minorUnits: 2 },
  { code: 'INR', name: 'Indian Rupee', symbol: 'Rs', minorUnits: 2 },
  { code: 'USD', name: 'US Dollar', symbol: '$', minorUnits: 2 },
  { code: 'GBP', name: 'Pound Sterling', symbol: 'GBP', minorUnits: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', minorUnits: 2 },
] as const;

export async function seedReferenceData(
  db: Db,
): Promise<{ countries: number; currencies: number }> {
  await db
    .insert(schema.countries)
    .values([...COUNTRIES])
    .onConflictDoNothing();
  await db
    .insert(schema.currencies)
    .values([...CURRENCIES])
    .onConflictDoNothing();
  return { countries: COUNTRIES.length, currencies: CURRENCIES.length };
}
