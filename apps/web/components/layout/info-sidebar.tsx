'use client';

import * as React from 'react';
import { Icons } from '@/components/icons';
import Link from 'next/link';
import {
  Infobar,
  InfobarContent,
  InfobarGroup,
  InfobarGroupContent,
  InfobarHeader,
  InfobarRail,
  InfobarTrigger,
  useInfobar,
  // Aliased: `InfobarContent` is already taken in this file by the layout component of the
  // same name exported alongside it.
  type InfobarContent as InfobarContentShape
} from '@/components/ui/infobar';

/**
 * Shown when a screen has not been given a guide of its own (`config/page-guides.ts`).
 *
 * Replaces the starter template's "Documentation / Installation Guide / #" placeholder, which
 * was the only thing this panel had ever displayed because no page passed it any content. A
 * placeholder left in a shipped screen is exactly what engineering rule 14 rules out; this at
 * least tells the reader something true about the app they are in.
 */
const defaultData: InfobarContentShape = {
  title: 'About this screen',
  sections: [
    {
      title: 'No guide for this screen yet',
      description:
        'Most screens in the Hub explain themselves here: what you are looking at, how to add something, and what decides who sees what. This one has not been written yet.'
    },
    {
      title: 'Why a screen can look empty',
      description:
        'The Hub shows you only what your role and team allow, and that is decided on the server rather than by hiding buttons. An empty list is usually the rules working correctly. An administrator can change it in Settings → People & Access.'
    }
  ]
};

export function InfoSidebar({ ...props }: React.ComponentProps<typeof Infobar>) {
  const { content } = useInfobar();
  const data = content || defaultData;

  return (
    <Infobar {...props}>
      <InfobarHeader className='bg-sidebar sticky top-0 z-10 flex flex-row items-center justify-between gap-2 border-b px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='text-lg font-semibold wrap-break-word'>{data.title}</h2>
        </div>
        <div className='shrink-0'>
          <InfobarTrigger />
        </div>
      </InfobarHeader>
      <InfobarContent>
        <InfobarGroup>
          <InfobarGroupContent>
            <div className='flex flex-col gap-6 px-4 py-4'>
              {data.sections && data.sections.length > 0 ? (
                data.sections.map((section) => (
                  <div key={section.title} className='flex flex-col gap-3'>
                    {section.title && (
                      <h3 className='text-foreground text-sm font-semibold'>{section.title}</h3>
                    )}
                    {section.description && (
                      <p className='text-muted-foreground text-sm leading-relaxed'>
                        {section.description}
                      </p>
                    )}
                    {section.links && section.links.length > 0 && (
                      <div className='flex flex-col gap-2'>
                        <h4 className='text-muted-foreground text-xs font-medium tracking-wide uppercase'>
                          Learn more
                        </h4>
                        <ul className='flex flex-col gap-1.5'>
                          {section.links.map((link) => (
                            <li key={link.title}>
                              <Link
                                href={link.url}
                                className='text-primary flex items-center gap-1.5 text-sm underline'
                                target='_blank'
                                rel='noopener noreferrer'
                              >
                                <span>{link.title}</span>
                                <Icons.chevronRight className='h-3 w-3' />
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className='text-muted-foreground px-2 py-4 text-center text-sm'>
                  No content available
                </div>
              )}
            </div>
          </InfobarGroupContent>
        </InfobarGroup>
      </InfobarContent>
      <InfobarRail />
    </Infobar>
  );
}
