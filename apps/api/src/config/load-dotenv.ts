import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Loads the repo-root `.env` into process.env for the API process.
 *
 * Nothing else does. Turbo's `globalEnv` declares variables for cache hashing;
 * it does not read `.env` files, and `nest start` does not either. Without this
 * the documented `cp .env.example .env && pnpm dev` boots straight into
 * "Invalid API environment: DATABASE_URL: Required" - the file exists, is
 * correct, and is never read.
 *
 * A variable already present in the environment WINS. That ordering is what
 * makes this safe in CI and in a container, where the real values arrive as
 * actual environment variables and a stray checked-in `.env` must not
 * overwrite them. `process.loadEnvFile()` would clobber them, which is why this
 * parses and merges instead.
 *
 * Imported for its side effect, and imported FIRST in main.ts: ESM evaluates
 * imported modules in source order, and AppModule validates the environment at
 * module load, before any of its providers are constructed.
 */
const here = dirname(fileURLToPath(import.meta.url));

export function loadDotenv(path = join(here, '..', '..', '..', '..', '.env')): void {
  let contents: string;
  try {
    contents = readFileSync(path, 'utf8');
  } catch {
    // No .env is a normal deployment: the environment supplies the values.
    return;
  }
  for (const [key, value] of Object.entries(parseEnv(contents))) {
    if (process.env[key] === undefined && typeof value === 'string') {
      process.env[key] = value;
    }
  }
}

loadDotenv();
