import { Badge } from '@/components/ui/badge';
import { TONE_CHIP_CLASSES, type Tone } from '@/lib/status-colors';
import { cn } from '@/lib/utils';

/**
 * A status pill colored by semantic tone (lib/status-colors.ts) rather than the
 * binary primary/secondary a plain `<Badge variant>` gives you — every status
 * column in the app (Projects, Clients, Reports) renders through this so a given
 * status always reads the same color everywhere.
 */
export function StatusBadge({
  tone,
  className,
  children
}: {
  tone: Tone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Badge variant='secondary' className={cn(TONE_CHIP_CLASSES[tone], className)}>
      {children}
    </Badge>
  );
}
