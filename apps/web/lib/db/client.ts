import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set — see .env.example');
}

// `prepare: false` is required against Neon's pgbouncer pooler endpoint (transaction mode
// pooling doesn't support prepared statements across connections).
const client = postgres(connectionString, { prepare: false });

export const db = drizzle(client, { schema });
