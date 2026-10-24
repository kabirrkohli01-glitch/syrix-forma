import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { db } from '@/lib/db/client';
import { clients, documentFiles, employees } from '@/lib/db/schema';

// Only auth() and the storage adapter are faked. The permission predicates, the scope condition
// and every database write run for real — same convention as tests/hr/leave-flow.test.ts. Storage
// is stubbed because the point of these tests is who may reach a document, not whether a
// pre-signed URL is well formed, and a real adapter would need a bucket.
const mockAuth = vi.fn();
vi.mock('@clerk/nextjs/server', () => ({ auth: () => mockAuth() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/storage', () => ({
  getStorageAdapter: () => ({
    createUploadUrl: async (key: string) => ({
      url: `https://storage.test/${key}`,
      method: 'PUT' as const
    }),
    createDownloadUrl: async (key: string) => `https://storage.test/${key}?signed`,
    deleteObject: async () => {}
  })
}));

const { archiveDocument, getDocumentDownloadUrl, requestDocumentUpload } = await import(
  '@/features/documents/actions'
);
const { listDocuments } = await import('@/features/documents/utils/queries');
const { requireActiveEmployee } = await import('@/lib/permissions/current-employee');

const runId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
const teams = { alpha: `docs-alpha-${runId}`, beta: `docs-beta-${runId}` };
const clerkIds = {
  alpha: `test_${runId}_alpha`,
  beta: `test_${runId}_beta`,
  lead: `test_${runId}_lead`,
  security: `test_${runId}_security`
};

const ids = { alpha: '', beta: '', lead: '', security: '' };
let alphaClientId = '';

function asCaller(key: keyof typeof clerkIds) {
  mockAuth.mockResolvedValue({ userId: clerkIds[key] });
}

async function callerFor(key: keyof typeof clerkIds) {
  asCaller(key);
  return requireActiveEmployee();
}

beforeAll(async () => {
  const inserted = await db
    .insert(employees)
    .values([
      {
        clerkUserId: clerkIds.alpha,
        name: 'Docs Alpha',
        email: `${clerkIds.alpha}@example.test`,
        role: 'EMPLOYEE',
        team: teams.alpha,
        status: 'active'
      },
      {
        clerkUserId: clerkIds.beta,
        name: 'Docs Beta',
        email: `${clerkIds.beta}@example.test`,
        role: 'EMPLOYEE',
        team: teams.beta,
        status: 'active'
      },
      {
        clerkUserId: clerkIds.lead,
        name: 'Docs Lead',
        email: `${clerkIds.lead}@example.test`,
        role: 'TEAM_LEAD',
        team: teams.alpha,
        status: 'active'
      },
      {
        clerkUserId: clerkIds.security,
        name: 'Docs Security',
        email: `${clerkIds.security}@example.test`,
        role: 'SECURITY_ADMIN',
        status: 'active'
      }
    ])
    .returning({ id: employees.id, clerkUserId: employees.clerkUserId });

  for (const row of inserted) {
    const key = (Object.keys(clerkIds) as (keyof typeof clerkIds)[]).find(
      (k) => clerkIds[k] === row.clerkUserId
    );
    if (key) ids[key] = row.id;
  }

  const [client] = await db
    .insert(clients)
    .values({ name: `Docs Client ${runId}`, team: teams.alpha, isSeedData: true })
    .returning({ id: clients.id });
  alphaClientId = client.id;
});

afterAll(async () => {
  await db.delete(documentFiles).where(inArray(documentFiles.uploadedByEmployeeId, Object.values(ids).filter(Boolean)));
  if (alphaClientId) await db.delete(clients).where(eq(clients.id, alphaClientId));
  await db.delete(employees).where(inArray(employees.clerkUserId, Object.values(clerkIds)));
});

async function uploadUnattached(key: keyof typeof clerkIds, title: string) {
  asCaller(key);
  return requestDocumentUpload({
    title,
    fileName: `${title}.pdf`,
    mimeType: 'application/pdf',
    sizeBytes: 1024
  });
}

describe('uploading', () => {
  it('files an unattached document under the uploader’s team', async () => {
    const result = await uploadUnattached('alpha', `Unattached ${runId}`);

    const [row] = await db
      .select()
      .from(documentFiles)
      .where(eq(documentFiles.id, result.documentId));
    expect(row.team).toBe(teams.alpha);
    expect(result.upload.url).toContain('documents/');
  });

  it('takes the client’s team, not the uploader’s, when attached to a client', async () => {
    asCaller('lead');
    const result = await requestDocumentUpload({
      title: `Attached ${runId}`,
      fileName: 'attached.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      clientId: alphaClientId
    });

    const [row] = await db
      .select()
      .from(documentFiles)
      .where(eq(documentFiles.id, result.documentId));
    expect(row.clientId).toBe(alphaClientId);
    expect(row.team).toBe(teams.alpha);
  });

  it('refuses a file type that is not on the allowlist', async () => {
    asCaller('alpha');
    await expect(
      requestDocumentUpload({
        title: 'Executable',
        fileName: 'payload.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 10
      })
    ).rejects.toThrow(/not accepted/i);
  });

  it('refuses to attach to a client the caller cannot reach', async () => {
    asCaller('beta');
    await expect(
      requestDocumentUpload({
        title: 'Sneaky',
        fileName: 'sneaky.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        clientId: alphaClientId
      })
    ).rejects.toThrow(/cannot add documents to that client/i);
  });
});

describe('who can see what', () => {
  it('does not show one team’s documents to another team', async () => {
    const alphaCaller = await callerFor('alpha');
    const betaCaller = await callerFor('beta');

    const alphaTitles = (await listDocuments(alphaCaller)).map((d) => d.title);
    const betaTitles = (await listDocuments(betaCaller)).map((d) => d.title);

    expect(alphaTitles).toContain(`Unattached ${runId}`);
    expect(betaTitles).not.toContain(`Unattached ${runId}`);
    expect(betaTitles).not.toContain(`Attached ${runId}`);
  });

  it('shows a SECURITY_ADMIN nothing at all', async () => {
    const securityCaller = await callerFor('security');
    expect(await listDocuments(securityCaller)).toHaveLength(0);
  });
});

describe('downloading by id', () => {
  it('refuses someone outside the team, with no hint that the document exists', async () => {
    const [row] = await db
      .select({ id: documentFiles.id })
      .from(documentFiles)
      .where(eq(documentFiles.team, teams.alpha))
      .limit(1);

    asCaller('beta');
    await expect(getDocumentDownloadUrl(row.id)).rejects.toThrow(/not available/i);
  });

  it('issues a URL to someone who is entitled', async () => {
    const [row] = await db
      .select({ id: documentFiles.id })
      .from(documentFiles)
      .where(eq(documentFiles.team, teams.alpha))
      .limit(1);

    asCaller('alpha');
    await expect(getDocumentDownloadUrl(row.id)).resolves.toMatchObject({
      url: expect.stringContaining('signed')
    });
  });
});

describe('withdrawing', () => {
  it('lets the uploader withdraw their own, and stops a colleague who is not a lead', async () => {
    const uploaded = await uploadUnattached('alpha', `Withdrawable ${runId}`);

    // Another EMPLOYEE on the same team can see it but must not remove it.
    const [sameTeamOther] = await db
      .insert(employees)
      .values({
        clerkUserId: `test_${runId}_alpha2`,
        name: 'Docs Alpha Two',
        email: `test_${runId}_alpha2@example.test`,
        role: 'EMPLOYEE',
        team: teams.alpha,
        status: 'active'
      })
      .returning({ id: employees.id });

    mockAuth.mockResolvedValue({ userId: `test_${runId}_alpha2` });
    await expect(archiveDocument(uploaded.documentId)).rejects.toThrow(/only the person who/i);

    asCaller('alpha');
    await archiveDocument(uploaded.documentId);

    const [row] = await db
      .select()
      .from(documentFiles)
      .where(eq(documentFiles.id, uploaded.documentId));
    // Archived, not deleted — a record pointing at it must not silently lose its evidence.
    expect(row).toBeDefined();
    expect(row.archivedAt).not.toBeNull();

    const alphaCaller = await callerFor('alpha');
    const titles = (await listDocuments(alphaCaller)).map((d) => d.title);
    expect(titles).not.toContain(`Withdrawable ${runId}`);

    await db.delete(employees).where(eq(employees.id, sameTeamOther.id));
  });
});
