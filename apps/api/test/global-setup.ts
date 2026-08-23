import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

/**
 * Starts a real Postgres and points DATABASE_URL at it BEFORE any test file is
 * imported.
 *
 * The ordering matters: `@nexmarket/db`'s client.ts reads DATABASE_URL at module
 * load, and the health check opens a real connection. Setting the variable
 * inside a beforeAll would be too late, because importing AppModule has already
 * constructed the pool.
 *
 * This is what makes `pnpm test` work on any machine with Docker, including CI,
 * without a separately provisioned database service.
 */
export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  process.env['DATABASE_URL'] = container.getConnectionUri();
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
