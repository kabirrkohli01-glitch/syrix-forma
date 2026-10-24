/**
 * Creates an empty database for a staging deployment, alongside the live one.
 *
 * A staging deployment runs on Clerk development keys, which accept sign-in from any origin. It
 * must therefore never be pointed at the live database: that holds real employee records,
 * client files and HR data, and putting it behind a weaker front door would undo every control
 * in this codebase at once. This creates a separate, empty database on the same Postgres
 * instance, which `drizzle-kit migrate` then builds the schema into.
 *
 * Creating a database does not read, move or alter anything in the live one.
 *
 *   npm run db:staging:create        # prints the connection URL to put in .env.staging
 */
import postgres from 'postgres';

const STAGING_DATABASE = 'syrix_forma_staging';

async function main() {
  const liveUrl = process.env.DATABASE_URL;
  if (!liveUrl) throw new Error('DATABASE_URL is not set — see .env.example');

  const stagingUrl = new URL(liveUrl);
  if (stagingUrl.pathname.replace(/^\//, '') === STAGING_DATABASE) {
    throw new Error(
      `DATABASE_URL already points at ${STAGING_DATABASE}. Run this with the live URL; it creates the staging database, it does not run against it.`
    );
  }

  // CREATE DATABASE cannot run inside a transaction, so this takes its own single connection
  // and issues the statement directly.
  const sql = postgres(liveUrl, { max: 1, idle_timeout: 5 });

  try {
    const existing = await sql`SELECT 1 FROM pg_database WHERE datname = ${STAGING_DATABASE}`;

    if (existing.length > 0) {
      console.log(`${STAGING_DATABASE} already exists — left untouched.`);
    } else {
      // The name is a constant in this file, never input, so interpolating it carries no risk
      // that a parameter would have removed. Identifiers cannot be bound as parameters anyway.
      await sql.unsafe(`CREATE DATABASE ${STAGING_DATABASE}`);
      console.log(`Created ${STAGING_DATABASE}.`);
    }

    stagingUrl.pathname = `/${STAGING_DATABASE}`;

    console.log('\nPut this in apps/web/.env.staging as DATABASE_URL:\n');
    console.log(stagingUrl.toString());
    console.log('\nThen build the schema into it:\n');
    console.log('  npx dotenv -e .env.staging -- npm run db:migrate\n');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
