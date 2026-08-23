/**
 * PRD 7.1: jobs are email, import, reindex, settlement.
 *
 * Phase 0 registers the queues and proves the Redis connection. Each later
 * phase replaces the placeholder handler with its real one.
 */
export const QUEUE_NAMES = ['email', 'import', 'reindex', 'settlement'] as const;

export type QueueName = (typeof QUEUE_NAMES)[number];

export function isQueueName(value: string): value is QueueName {
  return (QUEUE_NAMES as readonly string[]).includes(value);
}
