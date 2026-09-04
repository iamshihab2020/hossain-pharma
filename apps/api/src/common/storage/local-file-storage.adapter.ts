import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { Injectable } from '@nestjs/common';
import { loadApiEnv } from '../../config/env.js';
import type { FileStorage, PutMeta } from './file-storage.port.js';

/**
 * Development and test adapter. Writes under FILE_STORAGE_DIR.
 *
 * The key is `<tenantId>/<uuid>` and carries NO part of the caller's filename.
 * A user-supplied name in a filesystem path is a traversal bug waiting to be
 * written - `../../../etc/passwd` is a perfectly legal value for a multipart
 * filename field - and the only reliable defence is never to use it. The
 * original name is stored in the database column that exists for it, where it
 * is data rather than a path.
 */
@Injectable()
export class LocalFileStorage implements FileStorage {
  private readonly root = resolve(loadApiEnv().FILE_STORAGE_DIR);

  async put(bytes: Buffer, meta: PutMeta): Promise<{ storageKey: string }> {
    const storageKey = `${meta.tenantId}/${randomUUID()}`;
    const path = this.pathFor(storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    return { storageKey };
  }

  async get(storageKey: string): Promise<Buffer> {
    return readFile(this.pathFor(storageKey));
  }

  /**
   * Belt and braces. `put` only ever mints keys it controls, but `get` takes
   * whatever is in the database column, and a row written by some future code
   * path must not be able to read outside the root. Resolve first, then check
   * containment - string prefix checks on unresolved paths miss `a/../../b`.
   */
  private pathFor(storageKey: string): string {
    const path = resolve(join(this.root, storageKey));
    if (path !== this.root && !path.startsWith(this.root + sep)) {
      throw new Error('storage key escapes the storage root');
    }
    return path;
  }
}
