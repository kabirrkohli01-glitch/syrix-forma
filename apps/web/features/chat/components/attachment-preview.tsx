'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { getAttachmentDownloadUrl } from '@/features/chat/attachments-actions';
import { formatBytes } from '@/lib/utils';

/**
 * Returns the rendered glyph rather than the component.
 *
 * Selecting a component into a capitalised local during render makes React treat it as a new
 * component type on every render, which resets any state it holds. These icons are stateless so
 * nothing is visibly wrong today, but the shape is the bug — so the element is built here, at
 * module scope, and the caller only ever receives finished output.
 */
function iconForMimeType(mimeType: string, className: string) {
  if (mimeType === 'application/pdf') return <Icons.fileTypePdf className={className} />;
  if (mimeType.includes('word')) return <Icons.fileTypeDoc className={className} />;
  if (mimeType.includes('sheet') || mimeType.includes('excel')) {
    return <Icons.fileTypeXls className={className} />;
  }
  return <Icons.page className={className} />;
}

export function AttachmentPreview({
  attachment
}: {
  attachment: { id: string; fileName: string; mimeType: string; sizeBytes: number };
}) {
  const [isOpening, setIsOpening] = useState(false);

  async function handleOpen() {
    setIsOpening(true);
    try {
      const url = await getAttachmentDownloadUrl(attachment.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not open attachment');
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <button
      type='button'
      onClick={handleOpen}
      disabled={isOpening}
      className='hover:bg-muted flex max-w-64 items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors duration-150 disabled:opacity-60'
    >
      {iconForMimeType(attachment.mimeType, 'size-4 shrink-0')}
      <span className='min-w-0 truncate'>{attachment.fileName}</span>
      <span className='text-muted-foreground shrink-0 text-xs'>{formatBytes(attachment.sizeBytes)}</span>
    </button>
  );
}
