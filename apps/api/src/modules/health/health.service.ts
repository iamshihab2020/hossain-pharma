import { Injectable } from '@nestjs/common';
// eslint-disable-next-line no-restricted-imports
import { pool } from '@nexmarket/db';

// The import above is one of exactly two sanctioned uses of the raw pool
// outside packages/db (the other is the boot probe in main.ts). This is a
// liveness check: it opens a connection to prove one can be opened and reads no
// tenant data, so there is no tenant context for withTenant to carry.
// See PRD 6.4 criterion 2 for the rule this is an exception to.

export type HealthResponse = {
  status: 'ok' | 'degraded';
  database: 'ok' | 'unreachable';
};

@Injectable()
export class HealthService {
  async check(): Promise<HealthResponse> {
    try {
      await pool.query('SELECT 1');
      return { status: 'ok', database: 'ok' };
    } catch {
      return { status: 'degraded', database: 'unreachable' };
    }
  }
}
