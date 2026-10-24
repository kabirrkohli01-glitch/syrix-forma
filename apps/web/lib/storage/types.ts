export type UploadTarget = {
  url: string;
  method: 'PUT';
  headers?: Record<string, string>;
};

/**
 * Object storage for Team Chat attachments — bytes only, never anything the app itself
 * interprets. Two implementations: r2.ts (Cloudflare R2, the real path) and local-dev.ts (a
 * gitignored local folder, dev-only convenience per the engineering rules' "Constraints" section).
 * Callers get an adapter from lib/storage/index.ts's getStorageAdapter(), never import a
 * specific implementation directly.
 */
export interface StorageAdapter {
  createUploadUrl(storageKey: string, contentType: string): Promise<UploadTarget>;
  createDownloadUrl(storageKey: string): Promise<string>;
  deleteObject(storageKey: string): Promise<void>;
}
