import Link from 'next/link';
import * as React from 'react';
import { Icons } from '@/components/icons';
import { cn } from '@/lib/utils';

/**
 * Grouped inset list — a set of related rows presented as one object, with an
 * optional section label above and an explanatory note below.
 *
 * Chosen over a Card per row wherever the rows are a *set of one kind of thing*
 * (a profile's fields, a settings group, a leave balance breakdown). A stack of
 * separate cards makes each row look independently actionable and costs vertical
 * space to the gaps between them; one surface divided by hairlines reads as a
 * single record, which is what those screens actually contain.
 *
 * Dividers are inset to the row's text column rather than full-bleed, so the eye
 * follows one continuous left edge down the list instead of being cut across at
 * every row.
 */
export function ListGroup({
  label,
  note,
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & { label?: string; note?: React.ReactNode }) {
  return (
    // `w-full min-w-0` so the group takes the width it is given rather than the width its widest
    // row would like. A row's trailing value is `shrink-0`, so without this the group sized itself
    // to leading + label + an unshrinkable value (around 440px) and overflowed every phone. Bounded,
    // the row's `min-w-0` text column truncates instead, which is what it is there for.
    <div className={cn('flex w-full min-w-0 flex-col gap-1.5', className)}>
      {label && (
        <h3 className='text-muted-foreground px-4 text-xs font-medium tracking-wide uppercase'>
          {label}
        </h3>
      )}
      <div
        data-slot='list-group'
        className='bg-card ring-foreground/10 flex flex-col overflow-hidden rounded-2xl ring-1 [--list-inset:--spacing(4)]'
        {...props}
      >
        {children}
      </div>
      {note && <p className='text-muted-foreground px-4 text-xs'>{note}</p>}
    </div>
  );
}

type ListRowProps = {
  /** Main text for the row. */
  label: React.ReactNode;
  /** Secondary line under the label. */
  description?: React.ReactNode;
  /** Leading visual — an icon or avatar. */
  leading?: React.ReactNode;
  /** Trailing value, shown muted before any chevron. */
  value?: React.ReactNode;
  /** Trailing interactive control (a Switch, a Button). Suppresses the chevron. */
  action?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

export function ListRow({
  label,
  description,
  leading,
  value,
  action,
  href,
  onClick,
  disabled,
  className
}: ListRowProps) {
  const isNavigable = Boolean(href) || Boolean(onClick);
  // A row that both navigates and carries its own control would give the row two
  // different click targets with no way to tell them apart, so the chevron (the
  // affordance that says "this row goes somewhere") is dropped when there is one.
  const showChevron = Boolean(href) && !action;

  const content = (
    <>
      {leading && (
        <span className='text-muted-foreground flex size-7 shrink-0 items-center justify-center [&_svg]:size-5'>
          {leading}
        </span>
      )}
      <span className='flex min-w-0 flex-1 flex-col'>
        <span className='truncate text-sm font-medium'>{label}</span>
        {description && (
          <span className='text-muted-foreground truncate text-xs'>{description}</span>
        )}
      </span>
      {value && (
        <span className='text-muted-foreground shrink-0 text-sm tabular-nums'>{value}</span>
      )}
      {action && <span className='shrink-0'>{action}</span>}
      {showChevron && <Icons.chevronRight className='text-muted-foreground size-4 shrink-0' />}
    </>
  );

  const classes = cn(
    // min-h-11 is the 44px touch target engineering rule 16 asks for, not a look.
    'relative flex min-h-11 w-full items-center gap-3 px-(--list-inset) py-2.5 text-start',
    // Inset hairline drawn as a pseudo-element so it starts at the text column and
    // stops at the last row, without needing a wrapper element per divider.
    "after:bg-separator after:absolute after:inset-x-0 after:bottom-0 after:h-px after:content-[''] after:start-(--list-inset) last:after:hidden",
    isNavigable &&
      !disabled &&
      'hover:bg-muted/60 active:bg-muted transition-colors duration-150 ease-[cubic-bezier(0.2,0,0,1)]',
    'focus-visible:ring-ring/50 outline-none focus-visible:z-10 focus-visible:ring-3',
    disabled && 'pointer-events-none opacity-50',
    className
  );

  if (href) {
    return (
      <Link href={href} aria-disabled={disabled || undefined} className={classes}>
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button type='button' onClick={onClick} disabled={disabled} className={classes}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}
