import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DriverCapabilityError, assertInteractiveTransactions } from './assert-driver.js';

let container: StartedPostgreSqlContainer;
let pool: Pool;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start();
  pool = new Pool({ connectionString: container.getConnectionUri() });
}, 180_000);

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

describe('assertInteractiveTransactions', () => {
  it('passes against a driver that holds a multi-statement transaction', async () => {
    await expect(assertInteractiveTransactions(pool)).resolves.toBeUndefined();
  });

  it('throws DriverCapabilityError when state does not survive between statements', async () => {
    // Simulates the Neon HTTP driver: every query is an independent round trip,
    // so a value set by SET LOCAL in one statement is invisible to the next.
    const statelessPool = {
      connect: () =>
        Promise.resolve({
          query: (text: string) =>
            Promise.resolve(text.includes('current_setting') ? { rows: [{ probe: null }] } : { rows: [] }),
          release: () => undefined,
        }),
    } as unknown as Pool;

    await expect(assertInteractiveTransactions(statelessPool)).rejects.toBeInstanceOf(
      DriverCapabilityError,
    );
  });

  it('wraps a connection failure as DriverCapabilityError rather than leaking it', async () => {
    const brokenPool = {
      connect: () => Promise.reject(new Error('ECONNREFUSED')),
    } as unknown as Pool;

    await expect(assertInteractiveTransactions(brokenPool)).rejects.toThrow(
      /Driver capability probe failed/,
    );
  });
});
