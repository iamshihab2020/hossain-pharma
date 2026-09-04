import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@nexmarket/db';
import { getRequestContext } from '../../common/request-context.js';
import type { OrgStatus } from '../../common/guards/capability.guard.js';
import { decodeCursor, toPage, type Page } from '../../common/pagination.js';
import { assertTransition } from '../orgs/lifecycle.js';
import { SearchIndexService } from '../search/search-index.service.js';

export type QueueItem = {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  status: OrgStatus;
  countryCode: string;
  createdAt: Date;
  documentCount: number;
};

export type ReviewQuery = {
  status?: OrgStatus;
  cursor?: string;
  limit: number;
};

/**
 * PRD 9.3 seller governance.
 *
 * Every method runs with `isAdmin` true and NO tenant, which is what makes the
 * queue possible: `platform_admin_bypass` in migration 0004 is what lets an
 * admin read seller_documents across every tenant, and `organisations` is
 * platform-owned with no policy at all. Neither is an accident and neither is a
 * loophole - reviewing sellers is the one job that is definitionally
 * cross-tenant.
 */
@Injectable()
export class AdminService {
  constructor(private readonly searchIndex: SearchIndexService) {}

  async queue(query: ReviewQuery): Promise<Page<QueueItem>> {
    const ctx = getRequestContext();

    const conditions: SQL[] = [];
    if (query.status !== undefined) {
      conditions.push(eq(schema.organisations.status, query.status));
    }
    if (query.cursor !== undefined && query.cursor !== '') {
      const cursor = decodeCursor(query.cursor);
      // A row-value comparison, not `created_at < x OR (created_at = x AND id <
      // y)` written out by hand. Postgres evaluates the tuple form as one
      // comparison, and the hand-written form is where an off-by-one that
      // repeats or skips exactly one row per page comes from.
      conditions.push(
        sql`(${schema.organisations.createdAt}, ${schema.organisations.id}) < (${new Date(cursor.createdAt)}, ${cursor.id}::uuid)`,
      );
    }

    // limit + 1: the extra row answers "is there another page?" without a COUNT
    // over a table that is growing while it is being read.
    const rows = await ctx.tx
      .select({
        id: schema.organisations.id,
        slug: schema.organisations.slug,
        legalName: schema.organisations.legalName,
        displayName: schema.organisations.displayName,
        status: schema.organisations.status,
        countryCode: schema.organisations.countryCode,
        createdAt: schema.organisations.createdAt,
      })
      .from(schema.organisations)
      .where(conditions.length === 0 ? undefined : and(...conditions))
      .orderBy(desc(schema.organisations.createdAt), desc(schema.organisations.id))
      .limit(query.limit + 1);

    const page = toPage(rows, query.limit);
    const counts = await this.documentCounts(page.items.map((o) => o.id));

    return {
      items: page.items.map((org) => ({ ...org, documentCount: counts.get(org.id) ?? 0 })),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * A second query over the page's ids rather than a correlated subquery in the
   * select list.
   *
   * The subquery version was written first and silently returned 0 for every
   * row. Drizzle renders column references inside a raw `sql` template in the
   * SELECT list WITHOUT table qualification, so
   * `WHERE ${sellerDocuments.tenantId} = ${organisations.id}` became
   * `WHERE "tenant_id" = "id"` - seller_documents compared to itself, always
   * false, no error. Nothing about the result said it was wrong.
   *
   * One extra round trip bounded by MAX_LIMIT is a cheap price for a query
   * whose correctness does not depend on how an ORM renders an identifier.
   */
  private async documentCounts(orgIds: string[]): Promise<Map<string, number>> {
    if (orgIds.length === 0) return new Map();
    const ctx = getRequestContext();
    const rows = await ctx.tx
      .select({ tenantId: schema.sellerDocuments.tenantId, n: count() })
      .from(schema.sellerDocuments)
      .where(inArray(schema.sellerDocuments.tenantId, orgIds))
      .groupBy(schema.sellerDocuments.tenantId);
    return new Map(rows.map((r) => [r.tenantId, r.n]));
  }

  approve(orgId: string): Promise<QueueItem> {
    return this.transition(orgId, 'ACTIVE', null);
  }

  /** PRD 9.3: a rejection carries a reason, and the org returns to DRAFT to be fixed. */
  reject(orgId: string, reason: string): Promise<QueueItem> {
    return this.transition(orgId, 'DRAFT', reason);
  }

  suspend(orgId: string, reason: string): Promise<QueueItem> {
    return this.transition(orgId, 'SUSPENDED', reason);
  }

  reinstate(orgId: string): Promise<QueueItem> {
    return this.transition(orgId, 'ACTIVE', null);
  }

  /**
   * One write path for every status change, so the audit fields cannot be set
   * on three routes and forgotten on the fourth.
   *
   * The read and the write are in the same transaction - the interceptor's -
   * so the status this validated against is the status it updates. Two separate
   * transactions would let two admins approve and suspend the same org from the
   * same starting state.
   */
  private async transition(
    orgId: string,
    to: OrgStatus,
    note: string | null,
  ): Promise<QueueItem> {
    const ctx = getRequestContext();

    const found = await ctx.tx
      .select({ status: schema.organisations.status })
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1)
      // FOR UPDATE, so a concurrent reviewer waits rather than reading the same
      // pre-transition status and writing over the top of the first decision.
      .for('update');
    const current = found[0];
    if (current === undefined) throw new NotFoundException('No such organisation');

    assertTransition(current.status, to);

    const updated = await ctx.tx
      .update(schema.organisations)
      .set({
        status: to,
        reviewedBy: ctx.userId,
        reviewedAt: new Date(),
        reviewNote: note,
        updatedAt: new Date(),
      })
      .where(eq(schema.organisations.id, orgId))
      .returning();
    const org = updated[0];
    if (org === undefined) throw new ConflictException('The organisation changed during review');

    // THE LEAST OBVIOUS REINDEX HOOK. A suspended seller's offers stop being
    // eligible, so the cheapest price and the seller count change on every
    // product they list - and nothing about this method looks like it touches
    // search. Without it the index advertises a price nobody will honour.
    await this.searchIndex.reindexForTenant(ctx.tx, orgId);

    const documents = await ctx.tx
      .select({ id: schema.sellerDocuments.id })
      .from(schema.sellerDocuments)
      .where(eq(schema.sellerDocuments.tenantId, orgId));

    return {
      id: org.id,
      slug: org.slug,
      legalName: org.legalName,
      displayName: org.displayName,
      status: org.status,
      countryCode: org.countryCode,
      createdAt: org.createdAt,
      documentCount: documents.length,
    };
  }
}
