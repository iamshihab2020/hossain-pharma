import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { parseSearchQuery, saveSearchSchema } from './dto.js';
import { DiscoveryService, type SavedSearch, type ViewedProduct } from './discovery.service.js';
import { SearchService, type SearchHit, type SearchResult } from './search.service.js';

const MAX_SUGGESTIONS = 10;

/**
 * Discovery, PRD 9.1.
 *
 * Search, suggest and similar are @Public(): they read `search_documents`,
 * every row of which describes an ACTIVE product that already has a public
 * page. Requiring a login to search a marketplace would make the catalogue
 * undiscoverable, which is the opposite of the point.
 */
@ApiTags('search')
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Public()
  @Get('search')
  async run(@Req() req: FastifyRequest): Promise<SearchResult> {
    // The whole query object, not named parameters: attribute filters arrive as
    // `attr.<key>=<value>` and their keys are not known at compile time.
    return this.search.search(parseSearchQuery((req.query ?? {}) as Record<string, unknown>));
  }

  @Public()
  @Get('search/suggest')
  async suggest(@Query('q') q: string | undefined): Promise<{ items: { slug: string; name: string }[] }> {
    const term = (q ?? '').trim();
    // Two characters is where a prefix stops being a suggestion and starts
    // being a scan of the catalogue.
    if (term.length < 2) return { items: [] };
    return { items: await this.search.suggest(term.slice(0, 100), MAX_SUGGESTIONS) };
  }

  @Public()
  @Get('products/:slug/similar')
  async similar(@Param('slug') slug: string): Promise<{ items: SearchHit[] }> {
    return { items: await this.search.similar(slug, MAX_SUGGESTIONS) };
  }
}

/**
 * The signed-in half. No @Public() anywhere, so the global guard closes it, and
 * everything is scoped to the caller's own user id in the service.
 */
@ApiTags('search')
@Controller('me')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}

  @Post('recently-viewed/:slug')
  async record(@Param('slug') slug: string): Promise<{ recorded: true }> {
    await this.discovery.recordView(slug);
    return { recorded: true };
  }

  @Get('recently-viewed')
  async viewed(): Promise<{ items: ViewedProduct[] }> {
    return { items: await this.discovery.recentlyViewed() };
  }

  @Post('saved-searches')
  async save(@Body() body: unknown): Promise<SavedSearch> {
    const parsed = saveSearchSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      );
    }
    return this.discovery.saveSearch(parsed.data);
  }

  @Get('saved-searches')
  async saved(): Promise<{ items: SavedSearch[] }> {
    return { items: await this.discovery.savedSearches() };
  }

  @Delete('saved-searches/:id')
  async remove(@Param('id') id: string): Promise<{ deleted: true }> {
    await this.discovery.deleteSavedSearch(id);
    return { deleted: true };
  }
}
