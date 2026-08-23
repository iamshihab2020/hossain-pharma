import { describe, expect, it } from 'vitest';
import { QUEUE_NAMES, isQueueName } from './queues.js';

describe('QUEUE_NAMES', () => {
  it('declares the phase-0 queue set', () => {
    expect(QUEUE_NAMES).toContain('email');
    expect(QUEUE_NAMES).toContain('import');
    expect(QUEUE_NAMES).toContain('reindex');
    expect(QUEUE_NAMES).toContain('settlement');
  });

  it('has no duplicates, because two workers on one name silently split jobs', () => {
    expect(new Set(QUEUE_NAMES).size).toBe(QUEUE_NAMES.length);
  });

  it('narrows an arbitrary string to a queue name', () => {
    expect(isQueueName('email')).toBe(true);
    expect(isQueueName('not-a-queue')).toBe(false);
  });
});
