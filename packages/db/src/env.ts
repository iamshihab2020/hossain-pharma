import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_MIGRATION_URL: z.string().url().optional(),
});

export type DbEnv = z.infer<typeof schema>;

export function loadDbEnv(source: NodeJS.ProcessEnv = process.env): DbEnv {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid database environment: ${detail}`);
  }
  return parsed.data;
}
