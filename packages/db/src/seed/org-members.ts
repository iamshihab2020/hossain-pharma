import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../schema/index.js';
import { makeWithTenant } from '../tenant-context.js';

type Db = NodePgDatabase<typeof schema>;

/**
 * THE TRAP, and the fix.
 *
 * org_members is RLS-enforced with FORCE, and the seed connects as
 * nexmarket_app, which is NOBYPASSRLS on purpose. A plain
 * `db.insert(orgMembers)` therefore inserts ZERO rows and throws nothing - the
 * WITH CHECK on tenant_isolation silently rejects every row whose tenant it
 * cannot attribute. The seed reports success against an empty table.
 *
 * Every insert here goes through withTenant so a tenant context exists for the
 * row being written. The alternative - running this part of the seed on the
 * owner connection - was rejected: it would mean the seed never exercises the
 * policies, so a broken policy would show up in production rather than here.
 * Seeding through the app role makes the seed itself an RLS test.
 *
 * Karim deliberately holds OWNER in acme-electronics, STAFF in
 * meridian-fashion and OWNER in northwind-home. That is PRD 5.1's headline
 * claim - one human, several orgs, different roles - and the seed is where it
 * is either true or obviously false.
 */
const MEMBERSHIPS = [
  { orgSlug: 'acme-electronics', email: 'karim@acme.test', role: 'OWNER' as const },
  { orgSlug: 'acme-electronics', email: 'nadia@acme.test', role: 'STAFF' as const },
  { orgSlug: 'acme-electronics', email: 'tanvir@acme.test', role: 'FINANCE' as const },
  { orgSlug: 'meridian-fashion', email: 'karim@acme.test', role: 'STAFF' as const },
  { orgSlug: 'meridian-fashion', email: 'nadia@acme.test', role: 'MANAGER' as const },
  // Karim owns a SECOND org as well, and that is load-bearing rather than
  // decorative. The Phase 1 cross-tenant concurrency proof needs one caller who
  // holds the same capability in two tenants; the only alternative caller is a
  // platform admin, whose platform_admin_bypass policy makes every row visible
  // and the test therefore vacuous. See apps/api/test/tenancy.e2e.test.ts.
  { orgSlug: 'northwind-home', email: 'karim@acme.test', role: 'OWNER' as const },
] as const;

export async function seedOrgMembers(db: Db): Promise<number> {
  const withTenant = makeWithTenant(db);

  const orgs = await db
    .select({ id: schema.organisations.id, slug: schema.organisations.slug })
    .from(schema.organisations);
  const users = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users);

  const orgBySlug = new Map(orgs.map((o) => [o.slug, o.id]));
  const userByEmail = new Map(users.map((u) => [u.email, u.id]));

  let inserted = 0;
  for (const m of MEMBERSHIPS) {
    const tenantId = orgBySlug.get(m.orgSlug);
    const userId = userByEmail.get(m.email);
    // A seed that silently skips rows is the same class of bug as the one this
    // whole module exists to defuse. Fail loudly instead.
    if (tenantId === undefined || userId === undefined) {
      throw new Error(`Seed inconsistency: no org "${m.orgSlug}" or user "${m.email}"`);
    }
    await withTenant({ tenantId, userId: null, isAdmin: false }, async (tx) => {
      await tx
        .insert(schema.orgMembers)
        .values({ tenantId, userId, role: m.role })
        .onConflictDoNothing();
    });
    inserted += 1;
  }
  return inserted;
}
