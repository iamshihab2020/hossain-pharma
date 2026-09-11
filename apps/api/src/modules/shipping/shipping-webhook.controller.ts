import { Controller, HttpCode, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/public.decorator.js';
import { MockCarrierAdapter } from './mock-carrier.adapter.js';
import { TRACKING_EVENTS, type TrackingEventType } from './shipping-provider.port.js';
import { TrackingService, type TrackingOutcome } from './tracking.service.js';

/**
 * The carrier's callback: `POST /webhooks/shipping/:provider`.
 *
 * @Public() because a courier holds no NexMarket session - the SIGNATURE is the
 * authentication, verified in constant time inside the adapter, against a
 * secret that is deliberately not the payment one.
 *
 * The THIRD public write route, and less dangerous than the payment one but not
 * harmless: it moves order status, and an order forced to DELIVERED is an order
 * a buyer can no longer cancel. What protects it is the HMAC plus the fact that
 * a tracking number identifies exactly one parcel and nothing about it is
 * caller-chosen.
 *
 * ALWAYS 200 for a rejected event, for the same reason the payment webhook is:
 * a carrier reads any non-2xx as "retry", and answering 400 to a duplicate
 * turns one delivery into a storm. A tracking number we have never seen is the
 * one exception - that is a 404, because it means the carrier is talking to the
 * wrong system entirely and retrying will not help.
 */
@ApiTags('logistics')
@Public()
@Controller('webhooks/shipping')
export class ShippingWebhookController {
  constructor(
    private readonly tracking: TrackingService,
    private readonly carrier: MockCarrierAdapter,
  ) {}

  @Post(':provider')
  @HttpCode(200)
  async receive(
    @Param('provider') provider: string,
    @Req() req: FastifyRequest,
  ): Promise<TrackingOutcome> {
    if (provider !== this.carrier.name) throw new NotFoundException('Unknown carrier');

    // The RAW body. A signature is over bytes, and JSON.parse followed by
    // JSON.stringify does not round-trip them - key order and whitespace move.
    const raw = req.rawBody?.toString('utf8') ?? '';
    const headers = req.headers as Record<string, string | undefined>;

    if (!this.carrier.verify(raw, headers['x-carrier-signature'])) {
      // One answer for a forged signature and a malformed body. Telling them
      // apart tells an attacker which half to fix.
      return { applied: false, reason: 'invalid signature or payload' };
    }

    const event = readEvent(raw);
    if (event === null) {
      return { applied: false, reason: 'invalid signature or payload' };
    }

    return this.tracking.apply(event.trackingNumber, event.type);
  }
}

/**
 * The reported event out of a body we have already proved is ours.
 *
 * `type` is OPTIONAL: a carrier that names the event has it applied directly,
 * and one that does not gets the mock's time-compressed schedule instead. An
 * unrecognised type is treated as absent rather than rejected - a carrier
 * inventing a status we do not model should still advance the parcel by the
 * clock rather than being answered with an error it cannot act on.
 *
 * No zod schema: the signature check above already established that the body
 * was written by someone holding the shared secret, and this reads two fields.
 */
function readEvent(raw: string): { trackingNumber: string; type?: TrackingEventType } | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const body = parsed as { trackingNumber?: unknown; type?: unknown };
    const trackingNumber = body.trackingNumber;
    if (typeof trackingNumber !== 'string' || trackingNumber === '' || trackingNumber.length > 120) {
      return null;
    }

    const type = TRACKING_EVENTS.find((candidate) => candidate === body.type);
    return type === undefined ? { trackingNumber } : { trackingNumber, type };
  } catch {
    return null;
  }
}
