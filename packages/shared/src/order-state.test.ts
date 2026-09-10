import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  statusFromCoverage,
} from './order-state.js';

const line = (ordered: number, shipped = 0, cancelled = 0) => ({ ordered, shipped, cancelled });

describe('canTransition', () => {
  it('lets a seller accept a paid order', () => {
    expect(canTransition('PAID', 'ACCEPTED', 'SELLER')).toBe(true);
  });

  it('does not let a buyer accept their own order', () => {
    expect(canTransition('PAID', 'ACCEPTED', 'BUYER')).toBe(false);
  });

  it('does not let a seller accept an order twice', () => {
    expect(canTransition('ACCEPTED', 'ACCEPTED', 'SELLER')).toBe(false);
  });

  it('refuses every transition out of a terminal state', () => {
    for (const terminal of ['DELIVERED', 'CANCELLED', 'REJECTED'] as const) {
      for (const to of ['ACCEPTED', 'SHIPPED', 'CANCELLED'] as const) {
        expect(canTransition(terminal, to, 'SELLER')).toBe(false);
      }
    }
  });

  it('lets a buyer cancel only before anything dispatches', () => {
    expect(canTransition('PAID', 'CANCELLED', 'BUYER')).toBe(true);
    expect(canTransition('ACCEPTED', 'CANCELLED', 'BUYER')).toBe(true);
    expect(canTransition('PARTIALLY_SHIPPED', 'CANCELLED', 'BUYER')).toBe(false);
  });

  it('lets a seller reject only before accepting', () => {
    expect(canTransition('PAID', 'REJECTED', 'SELLER')).toBe(true);
    expect(canTransition('ACCEPTED', 'REJECTED', 'SELLER')).toBe(false);
  });

  it('reserves PAID for the webhook', () => {
    expect(canTransition('PENDING_PAYMENT', 'PAID', 'SYSTEM')).toBe(true);
    expect(canTransition('PENDING_PAYMENT', 'PAID', 'SELLER')).toBe(false);
    expect(canTransition('PENDING_PAYMENT', 'PAID', 'BUYER')).toBe(false);
  });

  it('lets a partly shipped order finish shipping but not be cancelled whole', () => {
    expect(canTransition('PARTIALLY_SHIPPED', 'SHIPPED', 'SELLER')).toBe(true);
    expect(canTransition('PARTIALLY_SHIPPED', 'CANCELLED', 'SELLER')).toBe(false);
  });

  it('lets only a seller mark a shipped order delivered', () => {
    expect(canTransition('SHIPPED', 'DELIVERED', 'SELLER')).toBe(true);
    expect(canTransition('SHIPPED', 'DELIVERED', 'BUYER')).toBe(false);
  });
});

describe('assertTransition', () => {
  it('throws InvalidTransitionError naming both states', () => {
    expect(() => assertTransition('DELIVERED', 'ACCEPTED', 'SELLER')).toThrow(
      InvalidTransitionError,
    );
    expect(() => assertTransition('DELIVERED', 'ACCEPTED', 'SELLER')).toThrow(
      /DELIVERED.*ACCEPTED/,
    );
  });

  it('returns silently on a legal transition', () => {
    expect(() => assertTransition('PAID', 'ACCEPTED', 'SELLER')).not.toThrow();
  });
});

describe('statusFromCoverage', () => {
  it('leaves an untouched order alone', () => {
    expect(statusFromCoverage([line(3)], 'ACCEPTED')).toBe('ACCEPTED');
  });

  it('is PARTIALLY_SHIPPED while units remain outstanding', () => {
    expect(statusFromCoverage([line(3, 1)], 'ACCEPTED')).toBe('PARTIALLY_SHIPPED');
  });

  it('is PARTIALLY_SHIPPED when one line of two is complete', () => {
    expect(statusFromCoverage([line(1, 1), line(2)], 'ACCEPTED')).toBe('PARTIALLY_SHIPPED');
  });

  it('is PARTIALLY_SHIPPED when some units shipped and others were cancelled', () => {
    expect(statusFromCoverage([line(3, 1, 1)], 'ACCEPTED')).toBe('PARTIALLY_SHIPPED');
  });

  it('is SHIPPED when every unit shipped', () => {
    expect(statusFromCoverage([line(2, 2), line(1, 1)], 'PARTIALLY_SHIPPED')).toBe('SHIPPED');
  });

  it('is SHIPPED when the outstanding remainder was cancelled', () => {
    expect(statusFromCoverage([line(3, 1, 2)], 'PARTIALLY_SHIPPED')).toBe('SHIPPED');
  });

  it('is CANCELLED when every unit was cancelled and none shipped', () => {
    expect(statusFromCoverage([line(2, 0, 2)], 'ACCEPTED')).toBe('CANCELLED');
  });

  it('never walks a DELIVERED order backwards', () => {
    expect(statusFromCoverage([line(1, 1)], 'DELIVERED')).toBe('DELIVERED');
  });

  it('rejects coverage that exceeds what was ordered', () => {
    expect(() => statusFromCoverage([line(1, 1, 1)], 'ACCEPTED')).toThrow(RangeError);
  });

  it('rejects an empty order', () => {
    expect(() => statusFromCoverage([], 'PAID')).toThrow(RangeError);
  });
});
