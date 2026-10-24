import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageAdapter, UploadTarget } from './types';

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function createClient(): S3Client {
  const accountId = requireEnv('R2_ACCOUNT_ID');
  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY')
    }
  });
}

export function createR2Adapter(): StorageAdapter {
  const bucket = requireEnv('R2_BUCKET_NAME');
  const client = createClient();

  return {
    async createUploadUrl(storageKey: string, contentType: string): Promise<UploadTarget> {
      const command = new PutObjectCommand({ Bucket: bucket, Key: storageKey, ContentType: contentType });
      const url = await getSignedUrl(client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
      return { url, method: 'PUT', headers: { 'Content-Type': contentType } };
    },

    async createDownloadUrl(storageKey: string): Promise<string> {
      const command = new GetObjectCommand({ Bucket: bucket, Key: storageKey });
      return getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
    },

    async deleteObject(storageKey: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }));
    }
  };
}
