'use client';

import * as React from 'react';
import { Icons } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useOptionalInfobar, type InfobarContent } from '@/components/ui/infobar';
import { cn } from '@/lib/utils';

interface InfoButtonProps extends Omit<React.ComponentProps<typeof Button>, 'content'> {
  content: InfobarContent;
  /** Visible text beside the icon. Without one the button is icon-only, labelled for readers. */
  label?: string;
  variant?: 'default' | 'ghost' | 'outline' | 'secondary' | 'destructive' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function InfoButton({
  content,
  label,
  className,
  variant = 'ghost',
  size,
  ...props
}: InfoButtonProps) {
  // Optional on purpose. The dashboard layout always provides the panel, but a page rendered
  // outside it has nowhere to open one, and a supplementary control must not take a page down.
  const infobar = useOptionalInfobar();
  const setContent = infobar?.setContent;

  // Hand the panel this page's content on mount so it is ready before anyone asks for it. The
  // click handler sets it again rather than relying on this: navigation ordering means the
  // mounted value can be superseded, and the click is the moment that has to be right.
  React.useEffect(() => {
    setContent?.(content);
  }, [content, setContent]);

  if (!infobar) return null;

  const handleClick: React.ComponentProps<typeof Button>['onClick'] = (e) => {
    infobar.setContent(content);
    infobar.setOpen(true);
    props.onClick?.(e);
  };

  return (
    <Button
      variant={variant}
      size={size ?? (label ? 'sm' : 'icon')}
      className={cn('text-muted-foreground shrink-0', className)}
      onClick={handleClick}
      aria-label={label ? undefined : 'What this screen is for'}
      {...props}
    >
      <Icons.info className='size-4' />
      {label ? <span>{label}</span> : <span className='sr-only'>What this screen is for</span>}
    </Button>
  );
}
