import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module.js';

/**
 * Root module. Each domain area from PRD 7.2 arrives as its own module under
 * `src/modules/` and is registered here: auth, tenancy, catalogue, search,
 * cart, checkout, orders, fulfilment, logistics, reviews, returns, promotions,
 * loyalty, ads, admin.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
