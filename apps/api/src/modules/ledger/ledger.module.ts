import { Global, Module } from '@nestjs/common';
import { LedgerService } from './ledger.service.js';

/**
 * @Global because the ledger is written from checkout, from the payment
 * webhook, and from Phase 8's refunds - every path where money moves. The
 * alternative is three modules importing this one and the fourth, added later,
 * posting its own entries instead. Same reasoning as SearchModule.
 */
@Global()
@Module({
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
