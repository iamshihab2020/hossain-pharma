import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * argon2id hash of "nexmarket-demo" at the Task 3 parameters.
 *
 * Hard-coded rather than computed so packages/db does not take a native
 * dependency on @node-rs/argon2 - which would pull it into the worker and the
 * ETL for no reason. Regenerate with:
 *   node -e "import('@node-rs/argon2').then(a=>a.hash('nexmarket-demo',{algorithm:2,memoryCost:19456,timeCost:2,parallelism:1}).then(console.log))"
 *
 * Demo credentials only. Never seeded into a production database.
 */
const DEMO_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$thRx5qdwb4uDzOSyD10+Nw$Hp0PmQOH1+1TFthjxCywCpcYHWtB9KTCWsbwCWWmCRc';

/**
 * PRD 5.1. platform_role is BUYER or ADMIN only - there is no SELLER value.
 * Karim, Nadia and Tanvir are BUYERs who also hold seller-org memberships; that
 * membership is what makes them sellers, not a field on this row.
 */
const USERS = [
  { email: 'admin@nexmarket.test', displayName: 'Shihab', platformRole: 'ADMIN' as const },
  { email: 'karim@acme.test', displayName: 'Karim Rahman', platformRole: 'BUYER' as const },
  { email: 'nadia@acme.test', displayName: 'Nadia Islam', platformRole: 'BUYER' as const },
  { email: 'tanvir@acme.test', displayName: 'Tanvir Ahmed', platformRole: 'BUYER' as const },
  { email: 'rina@buyer.test', displayName: 'Rina Chowdhury', platformRole: 'BUYER' as const },
] as const;

export async function seedUsers(db: Db): Promise<number> {
  await db
    .insert(schema.users)
    .values(USERS.map((u) => ({ ...u, passwordHash: DEMO_PASSWORD_HASH })))
    .onConflictDoNothing({ target: schema.users.email });
  return USERS.length;
}
