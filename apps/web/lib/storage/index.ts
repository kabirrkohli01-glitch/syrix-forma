import { createLocalDevAdapter } from './local-dev';
import { createR2Adapter } from './r2';
import type { StorageAdapter } from './types';

export type { StorageAdapter, UploadTarget } from './types';

function hasR2Config(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET_NAME
  );
}

/**
 * Picks the real R2 adapter whenever it's configured — even in development, so a developer who
 * *has* set up a bucket exercises the real path. Falls back to the local-dev adapter only when
 * R2 isn't configured AND this is genuinely a dev environment.
 *
 * Otherwise it throws, and that is the designed behaviour rather than an unhandled case. A
 * deployment without a bucket loses exactly three things: attaching a file to a message, and
 * uploading or downloading an HR or library document. Every caller is a Server Action, never
 * part of rendering a page, so no screen breaks and nothing else degrades.
 */
export function getStorageAdapter(): StorageAdapter {
  if (hasR2Config()) return createR2Adapter();

  if (process.env.NODE_ENV === 'development') return createLocalDevAdapter();

  // This message reaches a person, not a log. It is thrown from a Server Action and surfaces as
  // a toast to whoever just tried to attach a file, so it says what happened and who can fix it.
  // The variable names belong in the deployment's own logs — lib/config/preflight.ts warns there
  // at boot — not in front of an employee who cannot act on them.
  //
  // It names no single feature on purpose: Team Chat attachments, HR documents and the Documents
  // library all come through here, and an error naming only the first sends the reader looking in
  // the wrong place.
  throw new Error(
    'File storage is not set up for this installation yet, so files cannot be uploaded or downloaded. Everything else works as normal — ask a SYRIX Forma administrator to finish connecting it.'
  );
}
