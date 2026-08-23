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
      /Driver capability probe failed: ECONNREFUSED/,
    );
  });

  it('wraps a non-Error rejection too, so the boot message is never [object Object]', async () => {
    const oddPool = {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      connect: () => Promise.reject('socket hang up'),
    } as unknown as Pool;

    await expect(assertInteractiveTransactions(oddPool)).rejects.toThrow(
      /Driver capability probe failed: socket hang up/,
    );
  });

  it('surfaces an error code when the driver gives no message', async () => {
    const codeOnly = Object.assign(new Error(''), { code: 'ECONNREFUSED' });
    const pool = { connect: () => Promise.reject(codeOnly) } as unknown as Pool;

    await expect(assertInteractiveTransactions(pool)).rejects.toThrow(/ECONNREFUSED/);
  });

  it('unwraps an AggregateError, which is what a refused multi-address host raises', async () => {
    // node-postgres raises AggregateError with an EMPTY message when every
    // address for a host refuses. Naively reading .message renders
    // "probe failed: " and tells an on-call engineer nothing.
    const aggregate = new AggregateError(
      [Object.assign(new Error(''), { code: 'ECONNREFUSED' })],
      '',
    );
    const pool = { connect: () => Promise.reject(aggregate) } as unknown as Pool;

    const error = await assertInteractiveTransactions(pool).then(
      () => {
        throw new Error('expected a rejection');
      },
      (e: unknown) => e as Error,
    );

    expect(error.message).toMatch(/AggregateError/);
    expect(error.message).toMatch(/ECONNREFUSED/);
    expect(error.message).not.toMatch(/probe failed:\s*$/);
  });

  it('stringifies a rejection that is neither a string nor an Error', async () => {
    const pool = {
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
      connect: () => Promise.reject({ nope: true }),
    } as unknown as Pool;

    await expect(assertInteractiveTransactions(pool)).rejects.toThrow(
      /Driver capability probe failed: \[object Object\]/,
    );
  });

  it('falls back to the error name when there is nothing else at all', async () => {
    const bare = new Error('');
    bare.name = 'MysteriousFailure';
    const pool = { connect: () => Promise.reject(bare) } as unknown as Pool;

    await expect(assertInteractiveTransactions(pool)).rejects.toThrow(/MysteriousFailure/);
  });
});
