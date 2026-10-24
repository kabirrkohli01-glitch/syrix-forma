'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { setIntegrationEnabled, setIntegrationOwner } from '@/features/integrations/actions';
import type { IntegrationKey } from '@/lib/integrations/keys';

const NO_OWNER = '__none__';

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  connected: 'default',
  error: 'destructive',
  not_configured: 'outline'
};

export type EmployeeOption = { id: string; name: string };

export function IntegrationStatusCard({
  integrationKey,
  name,
  description,
  enabled,
  status,
  lastSyncAt,
  lastError,
  ownerEmployeeId,
  employeeOptions,
  children
}: {
  integrationKey: IntegrationKey;
  name: string;
  description: string;
  enabled: boolean;
  status: string;
  lastSyncAt: Date | null;
  lastError: string | null;
  ownerEmployeeId: string | null;
  employeeOptions: EmployeeOption[];
  children?: React.ReactNode;
}) {
  const [isPending, startTransition] = useTransition();

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      try {
        await setIntegrationEnabled(integrationKey, checked);
        toast.success(checked ? `${name} turned on` : `${name} turned off`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update this integration');
      }
    });
  }

  function handleOwnerChange(value: string | null) {
    startTransition(async () => {
      try {
        await setIntegrationOwner(integrationKey, value === NO_OWNER || !value ? null : value);
        toast.success('Owner updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update the owner');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-center justify-between gap-4'>
          <div>
            <CardTitle>{name}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <Switch checked={enabled} onCheckedChange={handleToggle} disabled={isPending} />
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-3'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant={STATUS_VARIANT[status] ?? 'outline'}>{status.replace('_', ' ')}</Badge>
          {lastSyncAt && (
            <span className='text-muted-foreground text-xs'>Last sync: {lastSyncAt.toLocaleString()}</span>
          )}
        </div>
        {lastError && <p className='text-destructive text-xs'>{lastError}</p>}

        <div className='flex flex-col gap-1.5'>
          <Label>Owner (named ADMIN)</Label>
          <Select value={ownerEmployeeId ?? NO_OWNER} onValueChange={handleOwnerChange} disabled={isPending}>
            <SelectTrigger size='sm' className='w-full'>
              <SelectValue placeholder='Unowned' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_OWNER}>Unowned</SelectItem>
              {employeeOptions.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {children}
      </CardContent>
    </Card>
  );
}
