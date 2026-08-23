import type { Pool, PoolClient } from 'pg';

export class DriverCapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverCapabilityError';
  }
}

/**
 * PRD section 6.5, blocking acceptance criterion.
 *
 * Neon's HTTP driver cannot hold an interactive transaction: each statement is a
 * separate round trip, so transaction-local state set by one statement is gone by
 * the next. Both RLS tenant context (SET LOCAL, via set_config with is_local=true)
 * and the double-entry ledger require that state to survive.
 *
 * This probe sets a transaction-local setting and reads it back in a SEPARATE
 * statement inside the SAME transaction. A driver that cannot do that returns null
 * and fails the boot here, rather than serving requests whose tenant context
 * silently does nothing.
 *
 * `pool.connect()` is inside the try on purpose: an unreachable database must
 * surface as a DriverCapabilityError too, not as a bare ECONNREFUSED.
 */
export async function assertInteractiveTransactions(pool: Pool): Promise<void> {
  let client: PoolClient | undefined;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.driver_probe', 'ok', true)");
    const result = await client.query<{ probe: string | null }>(
      "SELECT current_setting('app.driver_probe', true) AS probe",
    );
    await client.query('COMMIT');

    const probe = result.rows[0]?.probe ?? null;
    if (probe !== 'ok') {
      throw new DriverCapabilityError(
        'The configured Postgres driver cannot hold an interactive transaction. ' +
          `Expected the transaction-local setting to read back as "ok", got ${JSON.stringify(probe)}. ` +
          'RLS tenant context and the ledger both require multi-statement transactions. ' +
          'Use node-postgres over TCP or the Neon WebSocket Pool, not the Neon HTTP driver. ' +
          'See PRD section 6.5.',
      );
    }
  } catch (error) {
    if (error instanceof DriverCapabilityError) throw error;
    throw new DriverCapabilityError(`Driver capability probe failed: ${describe(error)}`);
  } finally {
    client?.release();
  }
}

/**
 * Drivers do not always give you a useful `message`. node-postgres raises an
 * AggregateError with an empty message when every address for a host refuses
 * the connection, which renders as "probe failed: " and tells an on-call
 * engineer nothing. Fall back through code, name, and nested causes.
 */
function describe(error: unknown): string {
  if (typeof error === 'string') return error;
  if (!(error instanceof Error)) return String(error);

  const parts: string[] = [];
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && code.length > 0) parts.push(code);
  if (error.message.length > 0) parts.push(error.message);

  if (parts.length === 0) {
    const nested = error instanceof AggregateError ? error.errors : [];
    const inner = nested.map((e: unknown) => describe(e)).filter((s) => s.length > 0);
    if (inner.length > 0) return `${error.name}: ${inner.join('; ')}`;
    return error.name;
  }

  return parts.join(' ');
}
