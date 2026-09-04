import { BadRequestException } from '@nestjs/common';

/**
 * PRD 13 makes cursor pagination mandatory on every collection endpoint. This
 * is the first one, so this is where the shape is decided.
 *
 * The cursor encodes `(createdAt, id)`, not an offset. An offset drifts the
 * moment a row is inserted ahead of the reader's position - and the approval
 * queue is precisely a list that grows while it is being read, so page 2 would
 * repeat an entry from page 1 and eventually hide one entirely. The id breaks
 * ties, because two organisations created in the same millisecond are ordinary,
 * not hypothetical.
 *
 * Base64 rather than a raw JSON string only so it survives a URL untouched. It
 * is NOT a secret and NOT tamper-proof: a caller who edits it gets a different
 * page of rows they were already allowed to see, since RLS and the guards run
 * regardless of where the page starts.
 */
export type Cursor = {
  readonly createdAt: string;
  readonly id: string;
};

export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;

export type Page<T> = {
  items: T[];
  nextCursor: string | null;
};

export function encodeCursor(row: { createdAt: Date; id: string }): string {
  const payload: Cursor = { createdAt: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): Cursor {
  const invalid = new BadRequestException('Invalid cursor');
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw invalid;
  }
  if (typeof parsed !== 'object' || parsed === null) throw invalid;
  const { createdAt, id } = parsed as Record<string, unknown>;
  if (typeof createdAt !== 'string' || typeof id !== 'string') throw invalid;
  // A cursor that parses but carries a nonsense timestamp would become
  // `TIMESTAMP 'undefined'` in the query and surface as a 500.
  if (Number.isNaN(Date.parse(createdAt))) throw invalid;
  return { createdAt, id };
}

/**
 * Rejects an oversized limit rather than clamping it.
 *
 * Clamping looks friendlier and is worse: the caller asked for 5000, got 100,
 * and their "did I reach the end?" test is `items.length < requested`, which is
 * now true on the first page. Silently returning a different page size than
 * asked for breaks pagination loops in a way that only shows up on large data.
 */
export function parseLimit(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_LIMIT;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new BadRequestException('limit must be a positive integer');
  }
  if (value > MAX_LIMIT) {
    throw new BadRequestException(`limit must not exceed ${MAX_LIMIT}`);
  }
  return value;
}

/**
 * Turns `limit + 1` rows into a page plus the cursor for the next one.
 *
 * Fetching one extra row is how "is there a next page?" gets answered without a
 * second COUNT query - and a COUNT over a growing table would be both slower
 * and wrong by the time it returned.
 */
export function toPage<T extends { createdAt: Date; id: string }>(
  rows: T[],
  limit: number,
): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last !== undefined ? encodeCursor(last) : null,
  };
}
