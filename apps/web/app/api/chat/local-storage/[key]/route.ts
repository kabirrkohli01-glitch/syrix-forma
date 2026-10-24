import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { resolveLocalPath } from '@/lib/storage/local-dev';
import { ForbiddenError, requireActiveEmployee } from '@/lib/permissions/current-employee';

// Backs lib/storage/local-dev.ts's presigned-URL-shaped dev fallback. Refuses to run at all
// outside development — this is the "never reachable once deployed" half of that adapter's
// contract, checked again here rather than trusted from the caller. Gated behind a real signed-
// in employee (not the full per-conversation participant check the issuing server action already
// did) since, unlike R2's presigned URLs, these aren't time-limited or key-signed.

async function assertLocalDev() {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    await requireActiveEmployee();
  } catch (err) {
    if (err instanceof ForbiddenError) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    throw err;
  }
  return null;
}

export async function PUT(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const denied = await assertLocalDev();
  if (denied) return denied;

  const { key } = await params;
  const storageKey = decodeURIComponent(key);
  const filePath = resolveLocalPath(storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  const body = Buffer.from(await req.arrayBuffer());
  await writeFile(filePath, body);

  return new NextResponse(null, { status: 200 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const denied = await assertLocalDev();
  if (denied) return denied;

  const { key } = await params;
  const storageKey = decodeURIComponent(key);
  const filePath = resolveLocalPath(storageKey);

  try {
    const data = await readFile(filePath);
    return new NextResponse(data, { status: 200 });
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
}
