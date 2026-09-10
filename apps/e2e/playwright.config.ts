import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The suite's own environment, never the repo's `.env`.
 *
 * `.env.e2e` points at 5434/6381 and a database this suite DROPS on every run.
 * Loading the root `.env` instead would point it at the development database,
 * and the first thing it does is drop the schema.
 */
loadEnv({ path: join(here, '.env.e2e') });

const BASE_URL = process.env['E2E_BASE_URL'] ?? 'http://localhost:3001';

/**
 * Chromium always; Firefox and WebKit only where there is memory for them.
 *
 * Three browsers driving a full stack on a 7.6 GB machine is where this suite
 * stops being usable locally, and a gate people stop running is worse than no
 * gate. CI has the headroom, and CI is what blocks merge.
 */
const crossBrowser = process.env['CI'] === 'true' || process.env['E2E_ALL_BROWSERS'] === '1';

/**
 * Set when Playwright runs INSIDE the baseline container, which talks to
 * servers already running on the host and must not start its own.
 */
const noServer = process.env['E2E_NO_SERVER'] === '1';

export default defineConfig({
  testDir: here,
  testMatch: /.*\.spec\.ts$/,

  /**
   * Serial, deliberately.
   *
   * The journeys move stock and order state through one seeded catalogue, and
   * two workers racing over it is exactly the non-determinism a GATE cannot
   * have. The suite is small enough that parallelism would buy seconds and cost
   * the property it exists for.
   */
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,

  reporter:
    process.env['CI'] === 'true'
      ? [['github'], ['html', { open: 'never' }]]
      : [['list']],

  use: {
    baseURL: BASE_URL,
    // Artefacts only when something broke. A green run leaves nothing behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(crossBrowser
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],

  ...(noServer
    ? {}
    : {
        webServer: [
          {
            command: 'pnpm --filter @nexmarket/api start',
            url: 'http://localhost:4001/health',
            reuseExistingServer: process.env['CI'] !== 'true',
            timeout: 180_000,
            cwd: join(here, '..', '..'),
            env: serverEnv(),
          },
          {
            // `exec next start` rather than the package's `start` script, which
            // hardcodes --port 3000 - appending another --port just passes the
            // flag twice and leaves which one wins up to Next.
            command: 'pnpm --filter @nexmarket/web exec next start --port 3001',
            url: BASE_URL,
            reuseExistingServer: process.env['CI'] !== 'true',
            timeout: 180_000,
            cwd: join(here, '..', '..'),
            env: serverEnv(),
          },
        ],
      }),
});

/**
 * Only the variables the servers need, and all of them explicitly.
 *
 * Passing the whole of `process.env` would let a stray DATABASE_URL from a
 * shell that had sourced `.env` win, and the API would come up against the
 * development database while every log line said otherwise.
 */
function serverEnv(): Record<string, string> {
  const keys = [
    'NODE_ENV',
    'DATABASE_URL',
    'DATABASE_MIGRATION_URL',
    'REDIS_URL',
    'API_PORT',
    'API_HOST',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'ACCESS_TOKEN_TTL_SECONDS',
    'REFRESH_TOKEN_TTL_DAYS',
    'COOKIE_DOMAIN',
    'COOKIE_SECURE',
    'WEB_APP_URL',
    'NEXT_PUBLIC_API_URL',
    'API_INTERNAL_URL',
    'FILE_STORAGE_DIR',
    'PAYMENT_WEBHOOK_SECRET',
  ];

  const env: Record<string, string> = {};
  for (const key of keys) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}
