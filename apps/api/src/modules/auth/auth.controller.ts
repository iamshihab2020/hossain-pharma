import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { COOKIE_OPTIONS, REFRESH_COOKIE } from './cookie.js';
import { AuthService, type AuthResult, type SessionMetadata } from './auth.service.js';
import { loginSchema, registerSchema } from './dto.js';

/** The refresh token is set as a cookie and NEVER returned in a body. */
type AuthBody = Omit<AuthResult, 'refreshToken'>;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthBody> {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(flatten(parsed.error.issues));
    return this.send(reply, await this.auth.register(parsed.data, metadata(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthBody> {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(flatten(parsed.error.issues));
    return this.send(reply, await this.auth.login(parsed.data, metadata(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AuthBody> {
    const token = readRefreshCookie(req);
    if (token === null) throw new UnauthorizedException('Invalid session');
    return this.send(reply, await this.auth.refresh(token, metadata(req)));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const token = readRefreshCookie(req);
    if (token !== null) await this.auth.logout(token);
    // Cleared unconditionally: a caller with an unknown token still gets rid of
    // it, and the response is identical either way.
    reply.clearCookie(REFRESH_COOKIE, { path: COOKIE_OPTIONS.path });
  }

  private send(reply: FastifyReply, result: AuthResult): AuthBody {
    reply.setCookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    // Rebuilt field by field rather than spread-minus-one: a future field added
    // to AuthResult then has to be named here to reach the body, so nothing
    // secret can leak into a response by being added upstream.
    return { accessToken: result.accessToken, user: result.user };
  }
}

function readRefreshCookie(req: FastifyRequest): string | null {
  const value = (req.cookies as Record<string, string | undefined> | undefined)?.[REFRESH_COOKIE];
  return value ?? null;
}

function metadata(req: FastifyRequest): SessionMetadata {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua : null, ipAddress: req.ip };
}

function flatten(issues: readonly { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}
