'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { searchHostingerMailbox } from '@/features/integrations/actions';
import type { HostingerMessageSummary } from '@/lib/integrations/hostinger-mail/client';

export function MailboxSearch() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<HostingerMessageSummary[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSearch() {
    startTransition(async () => {
      try {
        const messages = await searchHostingerMailbox(query);
        setResults(messages);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Search failed');
      }
    });
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex gap-2'>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Search sender, subject, or snippet'
          onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
        />
        <Button disabled={isPending} onClick={handleSearch}>
          Search
        </Button>
      </div>

      {results && (
        <div className='overflow-hidden rounded-lg border'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>From</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className='text-muted-foreground text-center text-sm'>
                    No messages matched.
                  </TableCell>
                </TableRow>
              ) : (
                results.map((message) => (
                  <TableRow key={message.uid}>
                    <TableCell className='font-medium'>{message.from}</TableCell>
                    <TableCell>{message.subject ?? '(no subject)'}</TableCell>
                    <TableCell className='text-muted-foreground text-xs'>
                      {new Date(message.date).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
