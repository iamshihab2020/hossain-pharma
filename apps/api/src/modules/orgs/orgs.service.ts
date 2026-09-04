import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { schema, type Transaction } from '@nexmarket/db';
import type { OrgRole } from '@nexmarket/shared';
import { getRequestContext } from '../../common/request-context.js';
import { translateDbErrors } from '../../common/db-errors.js';
import type { OrgStatus } from '../../common/guards/capability.guard.js';
import { assertTransition } from './lifecycle.js';
import { FILE_STORAGE, type FileStorage } from '../../common/storage/file-storage.port.js';
import {
  MAX_DOCUMENT_BYTES,
  type CreateOrgInput,
  type InviteMemberInput,
  type UpdateOrgInput,
  type UploadDocumentInput,
} from './dto.js';

export type MyOrg = {
  id: string;
  slug: string;
  displayName: string;
  status: string;
  roles: OrgRole[];
};

export type Org = {
  id: string;
  slug: string;
  legalName: string;
  displayName: string;
  status: OrgStatus;
  countryCode: string;
  defaultCurrency: string;
};

export type Member = {
  id: string;
  tenantId: string;
  userId: string;
  role: OrgRole;
  email: string;
  displayName: string;
};

export type Document = {
  id: string;
  tenantId: string;
  type: string;
  status: string;
  originalFilename: string;
  contentType: string;
  uploadedAt: Date;
};

/**
 * Every method reads its transaction from the request context rather than
 * taking a `db` handle. That is not style: the tenant GUCs are
 * transaction-local, so a query made on any other connection carries no tenant
 * context and, under FORCE RLS, sees nothing - or would tempt someone into
 * importing `db` and seeing everything. PRD 6.4 criterion 2.
 */
@Injectable()
export class OrgsService {
  constructor(@Inject(FILE_STORAGE) private readonly files: FileStorage) {}

  /**
   * PRD 5.1: one human, several organisations, a different role in each.
   *
   * Runs with tenantId null and relies on the `own_membership` policy, which is
   * why it can answer before any tenant is chosen. Deliberately NOT filtered by
   * user id in the WHERE clause alone - the policy is the boundary, and the
   * filter here is a query optimisation on top of it. If the policy were
   * dropped this would still be correct; if the filter were dropped the policy
   * would still be correct. Both, on purpose.
   */
  async listMine(): Promise<MyOrg[]> {
    const ctx = getRequestContext();
    const rows = await ctx.tx
      .select({
        id: schema.organisations.id,
        slug: schema.organisations.slug,
        displayName: schema.organisations.displayName,
        status: schema.organisations.status,
        role: schema.orgMembers.role,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.organisations, eq(schema.organisations.id, schema.orgMembers.tenantId))
      .where(eq(schema.orgMembers.userId, ctx.userId));

    const byOrg = new Map<string, MyOrg>();
    for (const row of rows) {
      const existing = byOrg.get(row.id);
      if (existing === undefined) {
        byOrg.set(row.id, {
          id: row.id,
          slug: row.slug,
          displayName: row.displayName,
          status: row.status,
          roles: [row.role],
        });
      } else {
        existing.roles.push(row.role);
      }
    }
    return [...byOrg.values()].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  /**
   * PRD 9.2 step 1. Creates a DRAFT organisation and makes the creator its
   * OWNER.
   *
   * No capability is required, and there is no tenant context: an organisation
   * that does not exist yet cannot be one. Anyone with an account may start a
   * seller application, which is what an open marketplace means; approval is
   * where the gate is (Task 12), not creation.
   */
  async create(input: CreateOrgInput): Promise<Org> {
    const ctx = getRequestContext();

    const inserted = await translateDbErrors(
      ctx.tx
        .insert(schema.organisations)
        .values({ ...input, status: 'DRAFT' })
        .onConflictDoNothing({ target: schema.organisations.slug })
        .returning(),
    );
    const org = inserted[0];
    if (org === undefined) throw new ConflictException('That slug is taken');

    await this.claimFoundingOwner(ctx.tx, org.id, ctx.userId, ctx.tenantId);
    return toOrg(org);
  }

  /**
   * Writes the founding OWNER row for an organisation created moments ago in
   * THIS transaction.
   *
   * org_members is tenant-isolated with FORCE, so the insert needs
   * app.tenant_id to equal the new organisation - and this request arrived with
   * no tenant, because the organisation did not exist when the interceptor ran.
   *
   * The context is therefore moved for exactly one statement and moved back.
   * `set_config(..., true)` is transaction-local both times, so nothing escapes
   * onto the pooled connection and the whole thing is atomic with the insert
   * above: a failure leaves no ownerless organisation behind.
   *
   * THIS IS THE ONLY PLACE OUTSIDE withTenant THAT WRITES app.tenant_id. It is
   * safe here because the tenant it moves to is one this transaction just
   * created, so there is no caller-supplied value anywhere in it. Do not copy
   * the shape to a tenant that came from a request.
   */
  private async claimFoundingOwner(
    tx: Transaction,
    tenantId: string,
    userId: string,
    restoreTo: string | null,
  ): Promise<void> {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    try {
      await tx.insert(schema.orgMembers).values({ tenantId, userId, role: 'OWNER' });
    } finally {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${restoreTo ?? ''}, true)`);
    }
  }

  async get(orgId: string): Promise<Org> {
    const ctx = this.requireTenant(orgId);
    const rows = await ctx.tx
      .select()
      .from(schema.organisations)
      .where(eq(schema.organisations.id, orgId))
      .limit(1);
    const org = rows[0];
    if (org === undefined) throw new NotFoundException('No such organisation');
    return toOrg(org);
  }

  async update(orgId: string, input: UpdateOrgInput): Promise<Org> {
    const ctx = this.requireTenant(orgId);
    const current = await this.get(orgId);
    // Business details are editable while the seller is still filling the form
    // and once they are live. Not during review: an admin approving a set of
    // details must be approving the ones they read.
    if (current.status === 'PENDING_REVIEW') {
      throw new ConflictException('Cannot edit an organisation while it is under review');
    }

    const updated = await ctx.tx
      .update(schema.organisations)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(schema.organisations.id, orgId))
      .returning();
    const org = updated[0];
    if (org === undefined) throw new NotFoundException('No such organisation');
    return toOrg(org);
  }

  /** PRD 9.2 step 4. Mock KYC - see plan D-D. */
  async addDocument(orgId: string, input: UploadDocumentInput): Promise<Document> {
    const ctx = this.requireTenant(orgId);

    const bytes = Buffer.from(input.contentBase64, 'base64');
    // Buffer.from ignores anything it cannot decode rather than throwing, so a
    // caller sending garbage would otherwise store an empty file and get a 201.
    if (bytes.length === 0) throw new BadRequestException('contentBase64 is not valid base64');
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException(`Documents are limited to ${MAX_DOCUMENT_BYTES} bytes`);
    }

    const { storageKey } = await this.files.put(bytes, {
      tenantId: orgId,
      contentType: input.contentType,
    });

    const inserted = await ctx.tx
      .insert(schema.sellerDocuments)
      .values({
        tenantId: orgId,
        type: input.type,
        storageKey,
        originalFilename: input.filename,
        contentType: input.contentType,
      })
      .returning();
    const doc = inserted[0];
    // Unreachable unless RLS refused the row, which raises rather than returns
    // nothing. Kept because "no row and no error" is the failure mode this
    // codebase keeps finding, and a silent 201 over an empty insert is exactly
    // that shape.
    if (doc === undefined) throw new ConflictException('Document could not be stored');
    return toDocument(doc);
  }

  async listDocuments(orgId: string): Promise<Document[]> {
    const ctx = this.requireTenant(orgId);
    // No WHERE on tenant_id: RLS is the boundary, and a filter here would hide
    // a broken policy instead of failing the test that exists to catch one.
    const rows = await ctx.tx.select().from(schema.sellerDocuments);
    return rows.map(toDocument);
  }

  /** PRD 9.2 step 5: DRAFT -> PENDING_REVIEW. */
  async submitForReview(orgId: string): Promise<Org> {
    const ctx = this.requireTenant(orgId);
    const current = await this.get(orgId);
    assertTransition(current.status, 'PENDING_REVIEW');

    const documents = await this.listDocuments(orgId);
    // An empty application would sit in the admin queue as a guaranteed
    // rejection. Refusing it here is the difference between a state machine and
    // a status column.
    if (documents.length === 0) {
      throw new ConflictException('Upload at least one document before submitting');
    }

    const updated = await ctx.tx
      .update(schema.organisations)
      .set({ status: 'PENDING_REVIEW', updatedAt: new Date() })
      .where(eq(schema.organisations.id, orgId))
      .returning();
    const org = updated[0];
    if (org === undefined) throw new NotFoundException('No such organisation');
    return toOrg(org);
  }

  /**
   * No WHERE on tenant_id. That is the point of the test that reads this list
   * under interleaved two-tenant load: if RLS is doing its job the rows are
   * already scoped, and if it is not, the test fails loudly instead of an
   * application filter quietly covering for a broken policy.
   */
  async listMembers(): Promise<Member[]> {
    const ctx = getRequestContext();
    const rows = await ctx.tx
      .select({
        id: schema.orgMembers.id,
        tenantId: schema.orgMembers.tenantId,
        userId: schema.orgMembers.userId,
        role: schema.orgMembers.role,
        email: schema.users.email,
        displayName: schema.users.displayName,
      })
      .from(schema.orgMembers)
      .innerJoin(schema.users, eq(schema.users.id, schema.orgMembers.userId));
    return rows;
  }

  async invite(input: InviteMemberInput): Promise<Member> {
    const ctx = getRequestContext();
    if (ctx.tenantId === null) throw new BadRequestException('No organisation selected');

    const found = await ctx.tx
      .select({ id: schema.users.id, displayName: schema.users.displayName })
      .from(schema.users)
      .where(eq(schema.users.email, input.email))
      .limit(1);
    const invitee = found[0];
    // Phase 1 invites an existing account only. Emailing an invitation to an
    // address with no account needs an invitation table and a token flow, which
    // is Phase 2's work - saying so is better than half-building it.
    if (invitee === undefined) throw new BadRequestException('No account with that email');

    const inserted = await ctx.tx
      .insert(schema.orgMembers)
      .values({
        tenantId: ctx.tenantId,
        userId: invitee.id,
        role: input.role,
        invitedBy: ctx.userId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.orgMembers.id });

    const row = inserted[0];
    if (row === undefined) throw new ConflictException('Already a member with that role');

    return {
      id: row.id,
      tenantId: ctx.tenantId,
      userId: invitee.id,
      role: input.role,
      email: input.email,
      displayName: invitee.displayName,
    };
  }

  /**
   * The path parameter and the tenant header must agree.
   *
   * The interceptor has already checked that the caller may act as the header's
   * organisation. Without this, `PATCH /orgs/<someone-elses-id>` carrying your
   * own header would edit their row - `organisations` is platform-owned and has
   * no RLS policy to stop it, by design, because admins read across all of it.
   */
  private requireTenant(orgId: string): ReturnType<typeof getRequestContext> {
    const ctx = getRequestContext();
    if (ctx.tenantId !== orgId) {
      throw new ForbiddenException('That organisation is not the active tenant');
    }
    return ctx;
  }
}

function toOrg(row: typeof schema.organisations.$inferSelect): Org {
  return {
    id: row.id,
    slug: row.slug,
    legalName: row.legalName,
    displayName: row.displayName,
    status: row.status,
    countryCode: row.countryCode,
    defaultCurrency: row.defaultCurrency,
  };
}

function toDocument(row: typeof schema.sellerDocuments.$inferSelect): Document {
  // storageKey is deliberately absent from the response. It is an opaque handle
  // owned by the FileStorage port, and putting it on the wire invites a client
  // to build a URL out of it.
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    status: row.status,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    uploadedAt: row.uploadedAt,
  };
}
