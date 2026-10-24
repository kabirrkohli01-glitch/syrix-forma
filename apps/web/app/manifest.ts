import type { MetadataRoute } from 'next';

/**
 * Web app manifest — what a phone reads when the Hub is added to a home screen.
 *
 * iOS does not read this for the icon; it reads app/apple-icon.png. This is what Android and
 * desktop Chrome use, and it is also what supplies the name shown under the icon on both.
 *
 * `robots: index: false` in the root layout still applies. A manifest describes an installed
 * app, it does not invite indexing, and the Hub remains unlisted either way.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SYRIX Forma',
    short_name: 'SYRIX Forma',
    description: 'Internal operating platform for teams.',
    start_url: '/dashboard',
    // Opening chrome-less is what makes an installed copy read as an application rather than a
    // saved page. Android only — iOS decides this from apple-mobile-web-app-capable, which is
    // deliberately left off so Safari keeps its address bar and reload.
    display: 'standalone',
    orientation: 'portrait-primary',
    // Matches the badge, so the launch screen and task-switcher chrome do not flash a colour the
    // app never uses.
    background_color: '#0850ab',
    theme_color: '#0850ab',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Android may crop an icon to any shape inside a circle of 80% of the canvas. The mark in
      // this one is inset to survive that; the 'any' icons above keep their full-bleed framing
      // where no crop is applied.
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ]
  };
}
