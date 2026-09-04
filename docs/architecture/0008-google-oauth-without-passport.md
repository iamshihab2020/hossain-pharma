# ADR 0008 - Google OAuth without Passport

**Status:** accepted
**Date:** 2026-08-29
**Phase:** 1
**Supersedes:** PRD decision D6, in part - the provider is unchanged, the library is not.

## Context

PRD D6 specifies "Google OAuth via Passport". The Phase 1 plan's first step for
that task says to install the dependency and check what it actually resolves to
before writing any config against it, because Phase 0's most expensive lesson
was assuming a version.

Installed and checked:

| Package | Resolved |
|---|---|
| `@nestjs/passport` | 12.0.0 |
| `passport` | 0.7.0 |
| `passport-google-oauth20` | 2.0.0 |
| `passport-oauth2` | 1.8.0 |

The versions are not the problem. The runtime contract is.

`@nestjs/passport`'s `AuthGuard` passes the framework response straight through
to passport:

```js
const [request, response] = [this.getRequest(context), this.getResponse(context)];
const passportFn = createPassportContext(request, response);
```

Under the Fastify adapter, `getResponse(context)` returns a `FastifyReply`.
Passport's redirect - the entire outbound leg of an OAuth code flow - is:

```js
res.statusCode = status || 302;
res.setHeader('Location', url);
res.setHeader('Content-Length', '0');
res.end();
```

`FastifyReply` has none of `statusCode`, `setHeader` or `end`. It has `.status()`,
`.header()` and `.send()`. `GET /auth/google` would throw
`res.setHeader is not a function` on the first request.

The workaround is to override `getResponse` to hand back `reply.raw`. That
bypasses Fastify's reply lifecycle on the *one* response in the system that sets
a session cookie, and leaves passport reading a `FastifyRequest` that has none
of the `logIn`/`logOut` methods it expects to augment.

## Decision

Drop Passport. Implement the authorization-code flow directly on `jose`, which
is already a dependency because it signs the access tokens.

The whole surface Passport was covering is three HTTP details against an
endpoint that has been stable for a decade: build an authorize URL, POST the
code to the token endpoint, read the response. That is `google.service.ts`, and
it is shorter than the adapter would have been.

Four dependencies removed rather than added.

## Consequences

**Better than the Passport route, not merely equivalent:**

- **The identity comes from the `id_token`, verified against Google's JWKS.**
  `email_verified` therefore arrives with a signature over it. The common
  Passport shape - and what SiloCRM does - is `GET /userinfo` with the access
  token, which returns the same fields as an unsigned JSON body whose integrity
  rests entirely on the transport.
- **`audience: clientId` is checked**, so an `id_token` minted for a different
  application, signed by the same Google keys, is rejected here.
- **The `state` parameter is a signed token we control** (`google-state.ts`).
  Passport's built-in state check requires a session store; without one it is
  simply off, which is login CSRF. Ours is an HS256 token with a distinct
  audience (`nexmarket-oauth-state`), so it can neither be forged nor swapped
  for an access token in either direction - there are tests for both directions.

**Costs:**

- Two Google endpoint URLs are now our constants rather than a library's. They
  are in `google.service.ts` and they are the documented, stable ones.
- Adding a second OAuth provider means writing its adapter rather than
  installing a strategy. Phase 9's problem, and the shape is now established.

**Unchanged:** the provider, the scopes, the table layout (`user_identities`,
one row per linked provider), and the requirement that an unverified Google
email never links to an existing account.

## Related

- `apps/api/src/modules/auth/google.service.ts`, `google.controller.ts`,
  `google-state.ts`
- ADR 0005 - the ESM constraint that makes dependency ergonomics matter here
- PRD 13 (identity), PRD 6.2 (identity is platform-owned)
