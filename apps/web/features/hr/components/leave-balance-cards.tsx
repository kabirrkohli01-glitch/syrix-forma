import { Card, CardContent } from '@/components/ui/card';
import { formatHalfDays } from '@/lib/hr/leave-calculation';

type Props = {
  totalHalfDays: number;
  takenHalfDays: number;
  pendingHalfDays: number;
  availableHalfDays: number;
  hasExplicitAllowance: boolean;
  year: { start: string; end: string };
};

function Figure({
  label,
  halfDays,
  tone = 'default'
}: {
  label: string;
  halfDays: number;
  tone?: 'default' | 'muted' | 'warning';
}) {
  return (
    <Card size='sm'>
      <CardContent className='flex flex-col gap-0.5'>
        <span
          className={
            tone === 'warning'
              ? 'text-destructive text-2xl font-semibold tabular-nums'
              : tone === 'muted'
                ? 'text-muted-foreground text-2xl font-semibold tabular-nums'
                : 'text-2xl font-semibold tabular-nums'
          }
        >
          {formatHalfDays(halfDays)}
        </span>
        <span className='text-muted-foreground text-xs'>{label}</span>
      </CardContent>
    </Card>
  );
}

export function LeaveBalanceCards({
  totalHalfDays,
  takenHalfDays,
  pendingHalfDays,
  availableHalfDays,
  hasExplicitAllowance,
  year
}: Props) {
  return (
    <div className='flex flex-col gap-2'>
      <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
        <Figure label='Allowance this year' halfDays={totalHalfDays} />
        <Figure label='Taken' halfDays={takenHalfDays} tone='muted' />
        <Figure label='Awaiting approval' halfDays={pendingHalfDays} tone='muted' />
        <Figure
          label='Left to book'
          halfDays={availableHalfDays}
          tone={availableHalfDays < 0 ? 'warning' : 'default'}
        />
      </div>
      <p className='text-muted-foreground px-1 text-xs'>
        Leave year {year.start} to {year.end}.{' '}
        {hasExplicitAllowance
          ? 'Allowance set by HR.'
          : 'No allowance has been set for you yet, so this uses the company default pro-rated to your contracted week.'}
      </p>
    </div>
  );
}
