if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile('.env.local');
  } catch {
    // No .env.local (e.g. CI) — DATABASE_URL must already be set in the environment.
  }
}
