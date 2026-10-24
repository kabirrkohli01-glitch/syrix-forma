import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    // Multiple test files share the same live Postgres dev database, including a handful of
    // genuinely global rows (automation_settings' singleton, every automations row — several
    // afterEach blocks reset ALL automations back to enabled with no per-row WHERE). Running
    // files in parallel lets one file's cleanup race another file's in-progress assertion against
    // those same rows, causing an intermittent, non-deterministic failure unrelated to any real
    // bug (observed directly this session). Serializing files trades some wall-clock time for a
    // CI signal that's actually trustworthy.
    fileParallelism: false
  },
  resolve: {
    alias: {
      '@': rootDir
    }
  }
});
