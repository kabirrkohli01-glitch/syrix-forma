'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { setEnquiryStatus } from '@/features/enquiries/actions';
import { enquiryStatusValues } from '@/features/enquiries/utils/schemas';

export function EnquiryStatusSelect({
  enquiryId,
  status
}: {
  enquiryId: string;
  status: (typeof enquiryStatusValues)[number];
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    if (!value) return;
    startTransition(async () => {
      try {
        await setEnquiryStatus(enquiryId, { status: value as (typeof enquiryStatusValues)[number] });
        toast.success('Status updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update status');
      }
    });
  }

  return (
    <Select value={status} onValueChange={handleChange} disabled={isPending}>
      <SelectTrigger size='sm' className='w-40'>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {enquiryStatusValues.map((value) => (
          <SelectItem key={value} value={value}>
            {value.replaceAll('_', ' ')}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
