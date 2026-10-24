import Providers from '@/components/layout/providers';
import { StagingBanner } from '@/components/layout/staging-banner';
import { Toaster } from '@/components/ui/sonner';
import { fontVariables } from '@/components/themes/font.config';
import { DEFAULT_THEME, THEMES } from '@/components/themes/theme.config';
import ThemeProvider from '@/components/themes/theme-provider';
import { cn } from '@/lib/utils';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import NextTopLoader from 'nextjs-toploader';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import '../styles/globals.css';

const META_THEME_COLORS = {
  light: '#ffffff',
  dark: '#09090b'
};

export const metadata: Metadata = {
  ...(process.env.NEXT_PUBLIC_APP_URL
    ? { metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL) }
    : {}),
  title: {
    default: 'SYRIX Forma',
    template: '%s | SYRIX Forma'
  },
  description: 'Internal operating platform for teams.',
  // Names the icon on an iOS home screen. Without it Safari labels it with the page title, so it
  // read whatever screen happened to be open at the moment it was added.
  //
  // `capable: false` keeps Safari's address bar and reload when it is launched from the home
  // screen. Opening chrome-less is a closer imitation of an app, but it also removes the only way
  // to see or retry a failed load — which matters while the Hub is reached through a tunnel.
  appleWebApp: {
    title: 'SYRIX Forma',
    capable: false
  },
  robots: {
    index: false,
    follow: false
  }
};

export const viewport: Viewport = {
  themeColor: META_THEME_COLORS.light
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const activeThemeValue = cookieStore.get('active_theme')?.value;
  const isValidTheme = THEMES.some((t) => t.value === activeThemeValue);
  const themeToApply = isValidTheme ? activeThemeValue! : DEFAULT_THEME;

  return (
    <html lang='en' suppressHydrationWarning data-theme={themeToApply}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              try {
                // Set meta theme color
                if (localStorage.theme === 'dark' || ((!('theme' in localStorage) || localStorage.theme === 'system') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '${META_THEME_COLORS.dark}')
                }
              } catch (_) {}
            `
          }}
        />
      </head>
      <body
        className={cn(
          'bg-background overflow-x-hidden overscroll-none font-sans antialiased',
          fontVariables
        )}
      >
        <NextTopLoader color='var(--primary)' showSpinner={false} />
        <NuqsAdapter>
          <ThemeProvider
            attribute='class'
            defaultTheme='system'
            enableSystem
            disableTransitionOnChange
            enableColorScheme
          >
            <Providers activeThemeValue={themeToApply}>
              <Toaster />
              <StagingBanner />
              {children}
            </Providers>
          </ThemeProvider>
        </NuqsAdapter>
      </body>
    </html>
  );
}
