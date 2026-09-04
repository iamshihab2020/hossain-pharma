import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  decodeCursor,
  encodeCursor,
  parseLimit,
  toPage,
} from './pagination.js';

const row = (iso: string, id: string) => ({ createdAt: new Date(iso), id });

describe('cursor', () => {
  it('round-trips a row', () => {
    const source = row('2026-09-04T10:00:00.000Z', '11111111-1111-4111-8111-111111111111');
    expect(decodeCursor(encodeCursor(source))).toEqual({
      createdAt: '2026-09-04T10:00:00.000Z',
      id: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('rejects garbage rather than paging from a silently empty position', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(BadRequestException);
    expect(() => decodeCursor(Buffer.from('[]').toString('base64url'))).toThrow(
      BadRequestException,
    );
    expect(() => decodeCursor(Buffer.from('null').toString('base64url'))).toThrow(
      BadRequestException,
    );
  });

  it('rejects a cursor whose fields are the wrong shape', () => {
    const bad = Buffer.from(JSON.stringify({ createdAt: 5, id: 'x' })).toString('base64url');
    expect(() => decodeCursor(bad)).toThrow(BadRequestException);
  });

  it('rejects a cursor carrying an unparseable timestamp', () => {
    // This one would otherwise reach the query as TIMESTAMP 'tomorrow-ish' and
    // come back as a 500 on what is a caller error.
    const bad = Buffer.from(JSON.stringify({ createdAt: 'tomorrow-ish', id: 'x' })).toString(
      'base64url',
    );
    expect(() => decodeCursor(bad)).toThrow(BadRequestException);
  });
});

describe('parseLimit', () => {
  it('defaults when absent or empty', () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_LIMIT);
    expect(parseLimit('')).toBe(DEFAULT_LIMIT);
  });

  it('accepts a value at the maximum', () => {
    expect(parseLimit(String(MAX_LIMIT))).toBe(MAX_LIMIT);
  });

  it('rejects a limit above the maximum rather than honouring it', () => {
    expect(() => parseLimit(String(MAX_LIMIT + 1))).toThrow(BadRequestException);
  });

  it('rejects zero, negatives and non-integers', () => {
    expect(() => parseLimit('0')).toThrow(BadRequestException);
    expect(() => parseLimit('-3')).toThrow(BadRequestException);
    expect(() => parseLimit('2.5')).toThrow(BadRequestException);
    expect(() => parseLimit('twenty')).toThrow(BadRequestException);
  });
});

describe('toPage', () => {
  it('returns nextCursor: null on the last page', () => {
    const rows = [row('2026-09-04T10:00:00.000Z', 'a'), row('2026-09-04T09:00:00.000Z', 'b')];
    expect(toPage(rows, 5).nextCursor).toBeNull();
    expect(toPage(rows, 5).items).toHaveLength(2);
  });

  it('drops the probe row and points the cursor at the last kept row', () => {
    const rows = [
      row('2026-09-04T10:00:00.000Z', 'a'),
      row('2026-09-04T09:00:00.000Z', 'b'),
      row('2026-09-04T08:00:00.000Z', 'c'),
    ];
    const page = toPage(rows, 2);
    expect(page.items.map((r) => r.id)).toEqual(['a', 'b']);
    expect(page.nextCursor).not.toBeNull();
    // The cursor is the LAST KEPT row, not the probe. Pointing it at the probe
    // would skip that row on the next page.
    expect(decodeCursor(page.nextCursor as string).id).toBe('b');
  });

  it('handles an empty result', () => {
    expect(toPage([], 10)).toEqual({ items: [], nextCursor: null });
  });
});
