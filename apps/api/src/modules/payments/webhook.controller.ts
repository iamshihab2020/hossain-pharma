import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { PaymentWebhookService, type WebhookOutcome } from './payment-webhook.service.js';

/**
 * The gateway's callback. @Public() because a gateway has no NexMarket session -
 * the SIGNATURE is the authentication, verified inside the adapter.
 *
 * This is the second public WRITE route in the system, and by far the more
 * dangerous one: it is the only path by which an anonymous POST can produce a
 * ledger entry saying a buyer paid. What protects it is the HMAC over the raw
 * body, checked in constant time, plus a unique constraint that makes a replay
 * a no-op.
 *
 * ALWAYS 200, even when the event is rejected. A gateway reads any non-2xx as
 * "retry", so answering 400 to a forged or duplicate delivery turns one bad
 * request into a retry storm. The outcome is in the body and in the logs, where
 * it belongs.
 */
@ApiTags('payments')
@Public()
@Controller('webhooks/payment')
export class PaymentWebhookController {
  constructor(private readonly webhooks: PaymentWebhookService) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Req() req: FastifyRequest,
  ): Promise<WebhookOutcome> {
    // The RAW body, captured by the body parser in configure-app.ts. A
    // signature is over bytes, and JSON.parse followed by JSON.stringify does
    // not round-trip them - key order and whitespace both move.
    const raw = req.rawBody?.toString('utf8') ?? '';
    return this.webhooks.handle(provider, raw, req.headers as Record<string, string | undefined>);
  }
}
