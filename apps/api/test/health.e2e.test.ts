import 'reflect-metadata';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { configureApp, createAdapter } from '../src/configure-app.js';

let app: NestFastifyApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication<NestFastifyApplication>(createAdapter());
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 60_000);

afterAll(async () => {
  await app?.close();
});

describe('GET /health', () => {
  it('reports the service and the database as ok', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok' });
  });

  it('serves an OpenAPI-describable route rather than a 404', async () => {
    const missing = await app.inject({ method: 'GET', url: '/definitely-not-a-route' });
    expect(missing.statusCode).toBe(404);
  });
});
