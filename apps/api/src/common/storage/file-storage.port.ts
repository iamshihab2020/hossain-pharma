/**
 * The boundary between "we hold a document" and "we hold it in S3".
 *
 * Plan D-D: Phase 1 ships this port and a local-filesystem adapter. Object
 * storage, signed URLs (PRD 13) and virus scanning are later phases. The point
 * of writing the port now is that the swap is an adapter change and nothing
 * else - no service, controller or test refers to a path, a bucket or a URL.
 *
 * `storageKey` is opaque. Nothing outside an adapter may parse, join or
 * interpret it; the moment something does, the port stops being a boundary.
 */
export type PutMeta = {
  readonly tenantId: string;
  readonly contentType: string;
};

export interface FileStorage {
  put(bytes: Buffer, meta: PutMeta): Promise<{ storageKey: string }>;
  get(storageKey: string): Promise<Buffer>;
}

/**
 * Injection token. An interface has no runtime value for Nest to key on, and a
 * string token is one typo away from a silent undefined at construction.
 */
export const FILE_STORAGE = Symbol('FileStorage');
