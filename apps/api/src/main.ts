import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
// eslint-disable-next-line no-restricted-imports
import { assertInteractiveTransactions, pool } from '@nexmarket/db';
import { AppModule } from './app.module.js';
import { loadApiEnv } from './config/env.js';

// The import above is one of exactly two sanctioned uses of the raw pool
// outside packages/db. The boot-time driver probe runs before any request and
// therefore before any tenant context exists, so withTenant has nothing to
// carry. See PRD 6.4 criterion 2 for the rule this is an exception to.

async function bootstrap(): Promise<void> {
  const env = loadApiEnv();

  // PRD 6.5, blocking acceptance criterion. This runs BEFORE the port opens, so
  // a driver that cannot hold interactive transactions fails the boot rather
  // than serving requests whose RLS context silently does nothing.
  await assertInteractiveTransactions(pool);

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());

  const config = new DocumentBuilder()
    .setTitle('NexMarket API')
    .setDescription('Universal multi-tenant marketplace')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config), {
    jsonDocumentUrl: 'docs-json',
  });

  await app.listen({ port: env.API_PORT, host: env.API_HOST });
  console.log(`API listening on http://localhost:${env.API_PORT} (docs at /docs)`);
}

bootstrap().catch((error: unknown) => {
  console.error('API failed to start:', error);
  process.exit(1);
});
