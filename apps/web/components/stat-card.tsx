import { AnimatedNumber } from '@/components/motion/animated-number';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function StatCard({
  label,
  value,
  sublabel
}: {
  label: string;
  value: string | number;
  sublabel?: string;
}) {
  return (
    <Card>
      <CardHeader className='pb-2'>
        <CardTitle className='text-muted-foreground text-[11px] font-medium tracking-wider uppercase'>
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className='text-3xl font-semibold tracking-tight'>
          {typeof value === 'number' ? <AnimatedNumber value={value} /> : value}
        </p>
        {sublabel && <p className='text-muted-foreground mt-1 text-xs'>{sublabel}</p>}
      </CardContent>
    </Card>
  );
}
