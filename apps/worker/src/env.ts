import { z } from 'zod';

const schema = z.object({
  REDIS_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type WorkerEnv = z.infer<typeof schema>;

export function loadWorkerEnv(source: NodeJS.ProcessEnv = process.env): WorkerEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid worker environment: ${detail}`);
  }
  return parsed.data;
}
