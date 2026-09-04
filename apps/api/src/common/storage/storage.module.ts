import { Global, Module } from '@nestjs/common';
import { FILE_STORAGE } from './file-storage.port.js';
import { LocalFileStorage } from './local-file-storage.adapter.js';

/**
 * The one place the FileStorage port is bound to an adapter.
 *
 * Plan D-D's whole point: swapping the local filesystem for object storage,
 * with signed URLs (PRD 13), is a change to the `useClass` below and nothing
 * else. Seller KYC documents and product media both come through here, so the
 * traversal rules and the opaque-key rule are enforced once.
 *
 * @Global because two unrelated modules already need it and a third (Phase 7
 * review photos) is coming; the alternative is every one of them importing
 * StorageModule and one of them eventually forgetting and binding its own.
 */
@Global()
@Module({
  providers: [{ provide: FILE_STORAGE, useClass: LocalFileStorage }],
  exports: [FILE_STORAGE],
})
export class StorageModule {}
