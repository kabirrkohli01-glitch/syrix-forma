'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function SearchInput({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = value.trim();
    router.push(trimmed ? `/dashboard/search?q=${encodeURIComponent(trimmed)}` : '/dashboard/search');
  }

  return (
    <form onSubmit={handleSubmit} className='flex gap-2'>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='Search clients, projects, tasks, staff, documents, emails…'
        autoFocus
      />
      <Button type='submit'>
        <Icons.search />
        Search
      </Button>
    </form>
  );
}
