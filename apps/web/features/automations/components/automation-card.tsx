'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { setAutomationDaysConfig, setAutomationEnabled, setAutomationOwner } from '@/features/automations/actions';
import { AUTOMATION_KEYS, type AutomationKey } from '@/lib/automations/keys';

const NO_OWNER = '__none__';

// Every automation whose config is a single "N days" value, the JSON field it lives under, and a
// short label for the input — keeps this card generic instead of one branch per automation.
const DAYS_CONFIG: Partial<Record<AutomationKey, { configKey: string; label: string }>> = {
  [AUTOMATION_KEYS.NO_RESPONSE_FOLLOW_UP]: { configKey: 'followUpAfterDays', label: 'Follow up after (days)' },
  [AUTOMATION_KEYS.CLIENT_INACTIVITY_FOLLOW_UP]: { configKey: 'inactivityThresholdDays', label: 'Inactive after (days)' },
  [AUTOMATION_KEYS.PROJECT_DEADLINE_REMINDER]: { configKey: 'daysBeforeDeadline', label: 'Remind before due (days)' }
};

export type AutomationCardData = {
  id: string;
  key: AutomationKey;
  name: string;
  description: string | null;
  triggerEvent: string;
  enabled: boolean;
  ownerEmployeeId: string | null;
  config: unknown;
};

export type EmployeeOption = { id: string; name: string };

export type AutomationRunStats = { count: number; lastRunAt: Date | null };

// 'ENQUIRY_CREATED' -> 'Enquiry created' — the raw trigger_event value is a stable identifier
// shared with the worker's dispatch table (lib/automations/keys.ts), not display text.
function formatTriggerEvent(raw: string): string {
  const lower = raw.toLowerCase().replaceAll('_', ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function AutomationCard({
  automation,
  employeeOptions,
  runStats = null
}: {
  automation: AutomationCardData;
  employeeOptions: EmployeeOption[];
  runStats?: AutomationRunStats | null;
}) {
  const [isPending, startTransition] = useTransition();
  const daysConfig = DAYS_CONFIG[automation.key];
  const currentDays = daysConfig
    ? ((automation.config as Record<string, number> | null)?.[daysConfig.configKey] ?? null)
    : null;
  const [days, setDays] = useState(String(currentDays ?? ''));

  function handleToggle(checked: boolean) {
    startTransition(async () => {
      try {
        await (setAutomationEnabled(automation.key, checked));
        toast.success(checked ? `${automation.name} turned on` : `${automation.name} turned off`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update this automation');
      }
    });
  }

  function handleOwnerChange(value: string | null) {
    startTransition(async () => {
      try {
        await (setAutomationOwner(automation.key, value === NO_OWNER || !value ? null : value));
        toast.success('Owner updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update the owner');
      }
    });
  }

  function handleSaveDays() {
    const parsed = Number(days);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      toast.error('Enter a positive number of days');
      return;
    }
    startTransition(async () => {
      try {
        await (setAutomationDaysConfig(automation.key, { days: parsed }));
        toast.success('Updated');
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to update this setting');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <div className='flex items-start justify-between gap-4'>
          <div>
            <CardTitle>{automation.name}</CardTitle>
            <CardDescription className='mt-1'>
              {runStats
                ? `Last run ${runStats.lastRunAt?.toLocaleString() ?? '—'} · ${runStats.count} total run${runStats.count === 1 ? '' : 's'}`
                : 'Never run yet'}
            </CardDescription>
          </div>
          <div className='flex shrink-0 items-center gap-2'>
            <Badge variant={automation.enabled ? 'default' : 'outline'}>
              {automation.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <Switch checked={automation.enabled} onCheckedChange={handleToggle} disabled={isPending} />
          </div>
        </div>
      </CardHeader>
      <CardContent className='flex flex-col gap-4'>
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
          <div className='bg-muted/50 rounded-md border p-3'>
            <p className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>Trigger</p>
            <p className='mt-1 text-sm'>{formatTriggerEvent(automation.triggerEvent)}</p>
          </div>
          <div className='bg-muted/50 rounded-md border p-3 sm:col-span-2'>
            <p className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>What it does</p>
            <p className='mt-1 text-sm'>{automation.description ?? '—'}</p>
          </div>
        </div>

        <div className='flex flex-col gap-1.5'>
          <Label>Owner</Label>
          <Select
            value={automation.ownerEmployeeId ?? NO_OWNER}
            onValueChange={handleOwnerChange}
            disabled={isPending}
          >
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

        {daysConfig && (
          <div className='flex items-end gap-2'>
            <div className='flex flex-col gap-1.5'>
              <Label htmlFor={`${automation.key}-days`}>{daysConfig.label}</Label>
              <Input
                id={`${automation.key}-days`}
                type='number'
                min={1}
                className='w-28'
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </div>
            <Button size='sm' variant='secondary' disabled={isPending} onClick={handleSaveDays}>
              Save
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
