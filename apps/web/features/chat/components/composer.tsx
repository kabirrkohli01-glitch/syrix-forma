'use client';

import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { confirmAttachment, requestAttachmentUpload } from '@/features/chat/attachments-actions';
import { sendMessage } from '@/features/chat/actions';
import { ALLOWED_ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_SIZE_BYTES } from '@/features/chat/utils/schemas';
import { formatBytes } from '@/lib/utils';

const ACCEPTED_EXTENSIONS = '.pdf,.png,.jpg,.jpeg,.webp,.gif,.txt,.doc,.docx,.xls,.xlsx,.ppt,.pptx';

export function Composer({ conversationId, onSent }: { conversationId: string; onSent: () => void }) {
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isSending, startSending] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleFilesPicked(fileList: FileList | null) {
    if (!fileList) return;
    const files = Array.from(fileList);
    const accepted = files.filter((file) => {
      if (!(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
        toast.error(`"${file.name}" isn't a supported file type`);
        return false;
      }
      if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
        toast.error(`"${file.name}" is over the ${formatBytes(MAX_ATTACHMENT_SIZE_BYTES)} limit`);
        return false;
      }
      return true;
    });
    setPendingFiles((prev) => [...prev, ...accepted]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  function handleSend() {
    const trimmed = body.trim();
    if (!trimmed || isSending) return;

    startSending(async () => {
      try {
        const message = await sendMessage({ conversationId, body: trimmed });

        for (const file of pendingFiles) {
          const target = await requestAttachmentUpload({
            conversationId,
            fileName: file.name,
            mimeType: file.type as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number],
            sizeBytes: file.size
          });

          const uploadResponse = await fetch(target.url, { method: 'PUT', headers: target.headers, body: file });
          if (!uploadResponse.ok) throw new Error(`Upload failed for "${file.name}"`);

          await confirmAttachment({
            messageId: message.id,
            storageKey: target.storageKey,
            fileName: file.name,
            mimeType: file.type as (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number],
            sizeBytes: file.size
          });
        }

        setBody('');
        setPendingFiles([]);
        onSent();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not send message');
      }
    });
  }

  return (
    <div className='border-border/60 bg-background/80 flex flex-col gap-2 border-t px-4 py-3 backdrop-blur-md'>
      {pendingFiles.length > 0 && (
        <div className='flex flex-wrap gap-2'>
          {pendingFiles.map((file, index) => (
            <span
              key={`${file.name}-${index}`}
              className='bg-muted flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs'
            >
              <Icons.paperclip className='size-3' />
              <span className='max-w-32 truncate'>{file.name}</span>
              <button type='button' onClick={() => removePendingFile(index)} aria-label={`Remove ${file.name}`}>
                <Icons.close className='size-3' />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className='bg-muted/60 flex items-end gap-1.5 rounded-2xl p-1.5'>
        <input
          ref={fileInputRef}
          type='file'
          multiple
          accept={ACCEPTED_EXTENSIONS}
          className='hidden'
          onChange={(e) => handleFilesPicked(e.target.files)}
        />
        <Button
          type='button'
          variant='ghost'
          size='icon'
          className='shrink-0 rounded-full'
          onClick={() => fileInputRef.current?.click()}
          aria-label='Attach files'
        >
          <Icons.paperclip className='size-4' />
        </Button>
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder='Write a message…'
          className='max-h-40 min-h-9 flex-1 resize-none border-none bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent'
        />
        <Button
          type='button'
          size='icon'
          className='shrink-0 rounded-full'
          onClick={handleSend}
          disabled={!body.trim() || isSending}
          aria-label='Send message'
        >
          <Icons.send className='size-4' />
        </Button>
      </div>
    </div>
  );
}
