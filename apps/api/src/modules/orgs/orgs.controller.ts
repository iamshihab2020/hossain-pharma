import { BadRequestException, Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { RequireCapability } from '../../common/decorators/capabilities.decorator.js';
import {
  createOrgSchema,
  inviteMemberSchema,
  updateOrgSchema,
  uploadDocumentSchema,
} from './dto.js';
import { OrgsService, type Document, type Member, type MyOrg, type Org } from './orgs.service.js';

/**
 * No @Public() anywhere in here, and no @UseGuards either. Both are the point:
 * the guard and the interceptor are global, so this controller is authenticated
 * and tenant-scoped by default rather than by remembering to say so.
 *
 * The tenant comes from the `x-tenant-id` header, checked against the caller's
 * memberships by the interceptor before this class is reached. Routes carrying
 * an `:id` also require that id to BE the active tenant - see requireTenant in
 * the service.
 */
@ApiTags('orgs')
@Controller('orgs')
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  /**
   * Deliberately carries no capability requirement: "which organisations am I
   * in?" is a question about the caller, not about any one organisation, and
   * requiring member:read here would make it unanswerable for a FINANCE user
   * who legitimately belongs to one.
   */
  @Get('mine')
  async mine(): Promise<{ items: MyOrg[] }> {
    return { items: await this.orgs.listMine() };
  }

  /**
   * PRD 9.2 step 1. No capability and no tenant: the organisation being created
   * cannot be the active tenant, because it does not exist yet.
   */
  @Post()
  async create(@Body() body: unknown): Promise<Org> {
    return this.orgs.create(parse(createOrgSchema, body));
  }

  @Get('members')
  @RequireCapability('member:read')
  async members(): Promise<{ items: Member[] }> {
    return { items: await this.orgs.listMembers() };
  }

  @Post('members')
  @RequireCapability('member:write')
  async invite(@Body() body: unknown): Promise<Member> {
    return this.orgs.invite(parse(inviteMemberSchema, body));
  }

  @Get(':id')
  @RequireCapability('settings:read')
  async get(@Param('id') id: string): Promise<Org> {
    return this.orgs.get(id);
  }

  @Patch(':id')
  @RequireCapability('settings:write')
  async update(@Param('id') id: string, @Body() body: unknown): Promise<Org> {
    return this.orgs.update(id, parse(updateOrgSchema, body));
  }

  @Get(':id/documents')
  @RequireCapability('settings:read')
  async documents(@Param('id') id: string): Promise<{ items: Document[] }> {
    return { items: await this.orgs.listDocuments(id) };
  }

  @Post(':id/documents')
  @RequireCapability('settings:write')
  async addDocument(@Param('id') id: string, @Body() body: unknown): Promise<Document> {
    return this.orgs.addDocument(id, parse(uploadDocumentSchema, body));
  }

  @Post(':id/submit')
  @RequireCapability('settings:write')
  async submit(@Param('id') id: string): Promise<Org> {
    return this.orgs.submitForReview(id);
  }
}

/**
 * One parser for every route. Zod's issue list is flattened into a single
 * message rather than returned structurally: a 400 body that mirrors the schema
 * tells a caller which fields exist, and this API has routes where that is a
 * membership oracle.
 */
function parse<T>(schema: { safeParse: (v: unknown) => SafeParse<T> }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  }
  return parsed.data;
}

type SafeParse<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: readonly { path: PropertyKey[]; message: string }[] } };
