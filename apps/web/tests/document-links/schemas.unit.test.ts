import { describe, expect, it } from 'vitest';
import { addDocumentLinkSchema } from '@/features/document-links/utils/schemas';

const validClientId = '11111111-1111-4111-8111-111111111111';
const validProjectId = '22222222-2222-4222-8222-222222222222';

describe('addDocumentLinkSchema', () => {
  it('accepts a link with exactly a clientId', () => {
    const result = addDocumentLinkSchema.safeParse({
      label: 'Client contract',
      url: 'https://example.sharepoint.com/doc',
      system: 'sharepoint',
      clientId: validClientId
    });
    expect(result.success).toBe(true);
  });

  it('accepts a link with exactly a projectId', () => {
    const result = addDocumentLinkSchema.safeParse({
      label: 'Project plan',
      url: 'https://example.com/plan',
      system: 'onedrive',
      projectId: validProjectId
    });
    expect(result.success).toBe(true);
  });

  it('rejects a link with neither clientId nor projectId', () => {
    const result = addDocumentLinkSchema.safeParse({
      label: 'Orphan link',
      url: 'https://example.com/doc',
      system: 'other'
    });
    expect(result.success).toBe(false);
  });

  it('rejects a link with both clientId and projectId', () => {
    const result = addDocumentLinkSchema.safeParse({
      label: 'Ambiguous link',
      url: 'https://example.com/doc',
      system: 'nas',
      clientId: validClientId,
      projectId: validProjectId
    });
    expect(result.success).toBe(false);
  });

  it('rejects a non-URL value', () => {
    const result = addDocumentLinkSchema.safeParse({
      label: 'Bad URL',
      url: 'not-a-url',
      system: 'nas',
      clientId: validClientId
    });
    expect(result.success).toBe(false);
  });
});
