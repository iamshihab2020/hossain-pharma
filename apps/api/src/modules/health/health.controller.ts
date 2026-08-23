import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthService, type HealthResponse } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  // Constructor injection on purpose: NestJS resolves this from design-time
  // type metadata emitted by the decorator transform. If the test runner ever
  // stops emitting that metadata, this route fails to construct and the health
  // test goes red - which is far better than discovering it in Phase 1 across
  // a dozen injected services.
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOkResponse({ description: 'Service and database liveness.' })
  async check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
