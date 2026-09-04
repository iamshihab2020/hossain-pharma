import { Controller, Get, Query, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { loadApiEnv, type ApiEnv } from '../../config/env.js';
import { AuthService, type SessionMetadata } from './auth.service.js';
import { COOKIE_OPTIONS, REFRESH_COOKIE } from './cookie.js';
import { GoogleService } from './google.service.js';
import { mintOAuthState, verifyOAuthState } from './google-state.js';

/**
 * The OAuth code flow, hand-rolled on `jose` rather than Passport.
 *
 * D6 specified `passport-google-oauth20`. It does not work under Fastify:
 * `@nestjs/passport` hands passport the FastifyReply, and passport's redirect
 * writes with `res.setHeader` / `res.statusCode` / `res.end`, none of which
 * FastifyReply has. Reaching for `reply.raw` to satisfy it means bypassing
 * Fastify's own lifecycle on the exact response that sets the session cookie.
 *
 * What Passport was doing for us is three HTTP details - build a URL, POST a
 * code, read the response - against an endpoint that has not changed in a
 * decade, so the adapter cost more than the library saved. See ADR 0008.
 */
@ApiTags('auth')
@Controller('auth/google')
export class GoogleController {
  private readonly env: ApiEnv = loadApiEnv();
  private readonly stateSecret = new TextEncoder().encode(this.env.JWT_ACCESS_SECRET);

  constructor(
    private readonly google: GoogleService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Get()
  async start(@Res({ passthrough: true }) reply: FastifyReply): Promise<void> {
    const state = await mintOAuthState(this.stateSecret);
    await reply.redirect(this.google.buildAuthUrl(state), 302);
  }

  /**
   * Every failure lands on the same web-app URL carrying `?error=google`, and
   * says nothing more.
   *
   * The callback runs in a browser address bar, so anything specific here ends
   * up in history, logs and Referer headers - and telling a caller whether an
   * address is registered, suspended or unverified is the same enumeration
   * oracle the login endpoint refuses to be.
   */
  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    if (!(await verifyOAuthState(state, this.stateSecret)) || code === undefined || code === '') {
      return this.fail(reply);
    }

    try {
      const profile = await this.google.exchangeCode(code);
      const { user } = await this.google.upsertFromProfile(profile);
      const result = await this.auth.issueForUser(user.id, metadata(req));
      reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    } catch {
      return this.fail(reply);
    }

    // Only the cookie crosses. The access token is deliberately NOT put in the
    // redirect URL - the web app calls POST /auth/refresh to get one, so the
    // credential never appears anywhere a URL is recorded.
    await reply.redirect(`${this.env.WEB_APP_URL}/auth/callback`, 302);
  }

  private async fail(reply: FastifyReply): Promise<void> {
    await reply.redirect(`${this.env.WEB_APP_URL}/login?error=google`, 302);
  }
}

function metadata(req: FastifyRequest): SessionMetadata {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua : null, ipAddress: req.ip };
}
