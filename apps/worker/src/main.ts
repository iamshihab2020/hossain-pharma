import { Worker } from 'bullmq';
// Named export, not default: ioredis 6 dropped the constructable default.
import { Redis } from 'ioredis';
import { loadWorkerEnv } from './env.js';
import { QUEUE_NAMES } from './queues.js';

const env = loadWorkerEnv();

// BullMQ requires maxRetriesPerRequest to be null on a blocking connection:
// its blocking pop is long-lived and ioredis would otherwise abort it mid-wait.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const workers = QUEUE_NAMES.map(
  (name) =>
    new Worker(
      name,
      (job) => {
        console.log(`[${name}] received job ${job.id ?? 'unknown'} (no handler registered yet)`);
        return Promise.resolve();
      },
      { connection, concurrency: 5 },
    ),
);

console.log(`Worker online. Queues: ${QUEUE_NAMES.join(', ')}`);

async function shutdown(signal: string): Promise<void> {
  console.log(`${signal} received, draining workers.`);
  await Promise.all(workers.map((w) => w.close()));
  await connection.quit();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
