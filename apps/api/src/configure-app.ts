import fastifyCookie from '@fastify/cookie';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
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

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The unparsed body, kept so a webhook signature can be verified against
     * the bytes the gateway actually signed. A Buffer, because that is what
     * Nest's adapter stores.
     */
    rawBody?: Buffer;
  }
}


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
  /**
   * Keep the RAW JSON body around, for payment webhooks.
   *
   * A gateway signs the BYTES it sent. `JSON.parse` followed by
   * `JSON.stringify` does not reproduce them - key order and whitespace both
   * move - so a signature verified against a re-serialised body fails for every
   * legitimate delivery.
   *
   * `adapter.useBodyParser` rather than `instance.addContentTypeParser`: Nest
   * registers its own JSON parser during `app.init()`, so adding one here
   * raises "Content type parser 'application/json' already present" at boot.
   * The adapter method replaces it AND sets the flag that stops Nest
   * re-registering, which is the supported way to own body parsing.
   *
   * It lives HERE rather than in main.ts because this is the one place the e2e
   * suite and the server share. Registered only in main.ts, every webhook test
   * would verify a signature against an empty body and fail for a reason that
   * has nothing to do with the code under test.
   */
  // The adapter type marks useBodyParser optional because the interface is
  // shared with Express; on FastifyAdapter it is always present.
  const adapter = app.getHttpAdapter() as FastifyAdapter;
  adapter.useBodyParser(
      'application/json',
      true,
      {},
      (_request: FastifyRequest, body: Buffer, done: (err: Error | null, value?: unknown) => void) => {
        const text = body.toString('utf8');
        // An empty body is a valid request to a route that takes no payload;
        // JSON.parse('') throws, which would turn those into 400s.
        if (text === '') {
          done(null, {});
          return;
        }
        try {
          done(null, JSON.parse(text) as unknown);
        } catch (error) {
          done(error as Error);
        }
    },
  );

  // PRD 13: the refresh token lives in an httpOnly cookie and never in JS.
  // Unsigned on purpose - the token is 256 bits of CSPRNG output checked
  // against a hash in `sessions`, so a signature would add a second secret to
  // rotate and prove nothing the lookup does not already prove.
  await app.register(fastifyCookie);
}
