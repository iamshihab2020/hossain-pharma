# @nexmarket/worker

BullMQ consumers. Keeps CPU-bound and latency-tolerant work off the request path.

## Layout

```
src/
├── main.ts        bootstrap: env, one Worker per queue, graceful drain
├── env.ts         zod-validated process.env
├── queues.ts      the queue registry and its type
└── handlers/      one file per job type (arrives with its phase)
```

## Queues

Declared in `src/queues.ts` per PRD 7.1. Phase 0 registers all four and proves
the Redis connection; each later phase replaces the placeholder handler.

| Queue | Purpose | Lands in |
|---|---|---|
| `email` | transactional mail | Phase 1 |
| `import` | seller bulk product import | Phase 10 |
| `reindex` | search document materialisation | Phase 3 |
| `settlement` | payout batching, COD reconciliation | Phase 6 |

## Notes

`maxRetriesPerRequest: null` on the ioredis connection is required, not
optional: BullMQ holds a long-lived blocking call and ioredis would otherwise
abort it mid-wait.

Redis is on host port **6380**, not 6379. See `docker-compose.yml`.

Shutdown drains in-flight jobs on SIGTERM and SIGINT before exiting, so a
redeploy does not strand a half-processed job.
