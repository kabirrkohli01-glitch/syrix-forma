'use client';

import { useMemo, useState, useTransition } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Icons } from '@/components/icons';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createConversation } from '@/features/chat/actions';
import { CONVERSATIONS_QUERY_KEY } from '@/features/chat/components/message-thread';

export type SelectOption = { id: string; name: string };

function initials(name: string) {
  return name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

function useFilteredEmployees(employees: SelectOption[], query: string) {
  return useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, query]);
}

export function NewConversationDialog({
  employees,
  onCreated
}: {
  employees: SelectOption[];
  onCreated: (conversationId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [dmQuery, setDmQuery] = useState('');
  const [groupQuery, setGroupQuery] = useState('');
  const [groupSelectedIds, setGroupSelectedIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isPending, startTransition] = useTransition();
  const queryClient = useQueryClient();

  const dmResults = useFilteredEmployees(employees, dmQuery);
  const groupResults = useFilteredEmployees(employees, groupQuery);

  function reset() {
    setDmQuery('');
    setGroupQuery('');
    setGroupSelectedIds([]);
    setGroupName('');
  }

  function toggleGroupMember(id: string) {
    setGroupSelectedIds((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));
  }

  function start(type: 'dm' | 'group', participantEmployeeIds: string[], name?: string) {
    startTransition(async () => {
      try {
        const result = await createConversation({ type, participantEmployeeIds, name });
        setOpen(false);
        reset();
        await queryClient.invalidateQueries({ queryKey: CONVERSATIONS_QUERY_KEY });
        onCreated(result.id);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not start the conversation');
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      {/* Sized to its label rather than to its row. Its only caller places it opposite the
          "Conversations" heading in a `justify-between` row, where `w-full` claimed the whole width
          of that row and the heading then pushed it past the right edge — clipped by the pane
          border on a wide screen, and a sideways-scrolling page on a narrow one. */}
      <DialogTrigger render={<Button size='sm' className='gap-1.5' />}>
        <Icons.add className='size-4' />
        New
      </DialogTrigger>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>Message one person directly, or start a group.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue='dm'>
          <TabsList className='w-full'>
            <TabsTrigger value='dm'>Direct message</TabsTrigger>
            <TabsTrigger value='group'>Group</TabsTrigger>
          </TabsList>

          <TabsContent value='dm' className='flex flex-col gap-2 pt-2'>
            <Input
              value={dmQuery}
              onChange={(e) => setDmQuery(e.target.value)}
              placeholder='Search people…'
              autoFocus
            />
            <div className='flex max-h-64 flex-col gap-0.5 overflow-y-auto'>
              {dmResults.length === 0 ? (
                <p className='text-muted-foreground py-4 text-center text-sm'>No one matches "{dmQuery}"</p>
              ) : (
                dmResults.map((employee) => (
                  <button
                    key={employee.id}
                    type='button'
                    disabled={isPending}
                    onClick={() => start('dm', [employee.id])}
                    className='hover:bg-muted flex items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors duration-150 disabled:opacity-60'
                  >
                    <Avatar size='sm'>
                      <AvatarFallback>{initials(employee.name)}</AvatarFallback>
                    </Avatar>
                    {employee.name}
                  </button>
                ))
              )}
            </div>
          </TabsContent>

          <TabsContent value='group' className='flex flex-col gap-2 pt-2'>
            <Input
              value={groupQuery}
              onChange={(e) => setGroupQuery(e.target.value)}
              placeholder='Search people…'
            />
            <div className='flex max-h-48 flex-col gap-0.5 overflow-y-auto'>
              {groupResults.map((employee) => (
                <label
                  key={employee.id}
                  className='hover:bg-muted flex items-center gap-2.5 rounded-md px-2 py-2 text-sm transition-colors duration-150'
                >
                  <Checkbox
                    checked={groupSelectedIds.includes(employee.id)}
                    onCheckedChange={() => toggleGroupMember(employee.id)}
                  />
                  <Avatar size='sm'>
                    <AvatarFallback>{initials(employee.name)}</AvatarFallback>
                  </Avatar>
                  {employee.name}
                </label>
              ))}
            </div>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor='group-name'>Group name (optional)</Label>
              <Input
                id='group-name'
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder='e.g. Client onboarding'
              />
            </div>
            <Button
              type='button'
              disabled={groupSelectedIds.length < 2 || isPending}
              onClick={() => start('group', groupSelectedIds, groupName.trim() || undefined)}
            >
              {isPending
                ? 'Starting…'
                : groupSelectedIds.length < 2
                  ? 'Pick at least 2 people'
                  : `Start group with ${groupSelectedIds.length} people`}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
