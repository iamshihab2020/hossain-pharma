import { Module } from '@nestjs/common';
import { OrgsController } from './orgs.controller.js';
import { OrgsService } from './orgs.service.js';

@Module({
  controllers: [OrgsController],
  providers: [OrgsService],
  exports: [OrgsService],
})
export class OrgsModule {}
