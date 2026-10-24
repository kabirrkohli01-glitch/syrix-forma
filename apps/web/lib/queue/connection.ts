import type { ConnectionOptions } from 'bullmq';

// Single source of truth for the Redis connection shape every Queue/Worker uses. `tls: {}`
// and `maxRetriesPerRequest: null` are both required against Upstash: TLS because Upstash only
// accepts `rediss://` connections, and the retry setting because BullMQ's blocking commands
// (used internally by Worker) fail under ioredis's default retry-limiting behavior.
export function getQueueConnection(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error('REDIS_URL is not set — see .env.example');
  }

  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: {},
    maxRetriesPerRequest: null
  };
}
