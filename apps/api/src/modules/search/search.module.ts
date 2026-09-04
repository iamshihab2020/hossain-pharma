import { Global, Module } from '@nestjs/common';
import { DiscoveryService } from './discovery.service.js';
import { SearchIndexService } from './search-index.service.js';
import { DiscoveryController, SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

/**
 * @Global because SearchIndexService is called from the catalogue, listings and
 * admin modules - every write path that can change what a buyer would find.
 * The alternative is three modules importing this one, and the fourth, added
 * later, forgetting to.
 */
@Global()
@Module({
  controllers: [SearchController, DiscoveryController],
  providers: [SearchService, SearchIndexService, DiscoveryService],
  exports: [SearchIndexService],
})
export class SearchModule {}
