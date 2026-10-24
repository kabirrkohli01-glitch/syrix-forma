import path from 'node:path';
import type { StorageAdapter, UploadTarget } from './types';

// Gitignored local folder, dev-only convenience so Team Chat is usable/testable before real
// R2 credentials exist (the engineering rules' "Constraints" section: a seeded dev convenience is fine,
// a shipped bypass is not). getStorageAdapter() only reaches this file when NODE_ENV is
// literally 'development' AND no R2 env vars are set — see lib/storage/index.ts.
export const LOCAL_UPLOADS_DIR = path.join(process.cwd(), '.local-uploads');

// Bytes move through a real Next.js route (app/api/chat/local-storage/[key]/route.ts) that
// itself refuses to run outside development, mirroring R2's presigned PUT/GET flow closely
// enough that feature code never needs to know which adapter is active.
export function createLocalDevAdapter(): StorageAdapter {
  return {
    async createUploadUrl(storageKey: string, contentType: string): Promise<UploadTarget> {
      return {
        url: `/api/chat/local-storage/${encodeURIComponent(storageKey)}`,
        method: 'PUT',
        headers: { 'Content-Type': contentType }
      };
    },

    async createDownloadUrl(storageKey: string): Promise<string> {
      return `/api/chat/local-storage/${encodeURIComponent(storageKey)}`;
    },

    async deleteObject(storageKey: string): Promise<void> {
      const fs = await import('node:fs/promises');
      const filePath = resolveLocalPath(storageKey);
      await fs.rm(filePath, { force: true });
    }
  };
}

/** Resolves a storage key to a path inside LOCAL_UPLOADS_DIR, rejecting any traversal attempt. */
export function resolveLocalPath(storageKey: string): string {
  const resolved = path.resolve(LOCAL_UPLOADS_DIR, storageKey);
  if (!resolved.startsWith(path.resolve(LOCAL_UPLOADS_DIR) + path.sep)) {
    throw new Error('Invalid storage key');
  }
  return resolved;
}
