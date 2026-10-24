import { InfoButton } from '@/components/ui/info-button';
import type { InfobarContent } from '@/components/ui/infobar';

interface HeadingProps {
  title: string;
  description: string;
  infoContent?: InfobarContent;
}

export function Heading({ title, description, infoContent }: HeadingProps) {
  return (
    <div>
      <div className='flex flex-wrap items-center gap-x-2 gap-y-1'>
        {/* tracking-title rather than Tailwind's tracking-tight: the optical correction
            a page title needs is a property of the type scale, so it lives in the theme
            tokens with the rest of the scale instead of being re-picked per heading. */}
        <h2 className='text-3xl leading-tight font-bold tracking-title md:text-[2rem]'>{title}</h2>
        {/* Labelled rather than a bare ⓘ. The panel behind it is where a screen says what it is,
            how to add something, and what decides who sees what — which is no use to someone who
            does not notice the control that opens it, and an icon alone is what people miss. */}
        {infoContent && <InfoButton content={infoContent} label='How this works' />}
      </div>
      <p className='text-muted-foreground text-sm'>{description}</p>
    </div>
  );
}
