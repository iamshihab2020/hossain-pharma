import fastifyCookie from '@fastify/cookie';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { MAX_DOCUMENT_BYTES } from './modules/orgs/dto.js';

/**
 * Fastify's default body limit is 1 MiB, which is below a 2 MiB KYC document
 * once base64 has added a third. Raised here, in the ONE place both main.ts and
 * the e2e suite build their adapter, because bodyLimit is a constructor option:
 * a second `new FastifyAdapter()` anywhere else silently reverts to 1 MiB and
 * the failure is a 413 in production that no test reproduces.
 *
 * The real per-document limit is enforced on the decoded bytes in the service.
 * This is only the outer envelope, sized to leave room for the encoding
 * overhead and the surrounding JSON rather than to be a second policy.
 */
const BODY_LIMIT_BYTES = MAX_DOCUMENT_BYTES * 2;

export function createAdapter(): FastifyAdapter {
  return new FastifyAdapter({ bodyLimit: BODY_LIMIT_BYTES });
}

/**
 * Everything the application needs registered on the Fastify instance, in one
 * place so `main.ts` and the e2e suite cannot drift.
 *
 * They drifted the obvious way before this existed: a plugin registered only in
 * main.ts is absent from every test, so `req.cookies` is undefined and the
 * refresh flow fails in a suite that is supposed to prove it works - or worse,
 * passes for the wrong reason.
 *
 * Call it before `app.init()`.
 */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  // PRD 13: the refresh token lives in an httpOnly cookie and never in JS.
  // Unsigned on purpose - the token is 256 bits of CSPRNG output checked
  // against a hash in `sessions`, so a signature would add a second secret to
  // rotate and prove nothing the lookup does not already prove.
  await app.register(fastifyCookie);
}
