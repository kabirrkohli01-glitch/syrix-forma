import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';
import { securityHeaders } from './lib/security/headers';

// Define the base Next.js configuration
const baseConfig: NextConfig = {
  output: process.env.BUILD_STANDALONE === 'true' ? 'standalone' : undefined,

  // Which directory this invocation builds into, so that two Next processes started from the
  // same checkout cannot share one.
  //
  // `next dev` and `next build`/`next start` both default to `.next`. Running a production build
  // while the dev server is up therefore overwrites, mid-flight, the exact chunks and route
  // manifests that server is handing to a browser. Nothing errors: the dev server keeps
  // returning 200s and its log stays clean, while pages arrive with no CSS or a route that
  // plainly exists answers 404. It reads as a catastrophic regression in the application and is
  // not one. Any environment that builds for deployment sets NEXT_DIST_DIR to something other
  // than `.next` and the two stop colliding.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Next's own floating dev-mode indicator, on top of the (now-removed) React Query Devtools
  // button — both sat in the same corner and got in the way while clicking through the app.
  devIndicators: false,

  // Announcing the framework and its major version to every visitor gains nothing and narrows
  // the search for anyone looking for a version-specific weakness.
  poweredByHeader: false,

  images: {
    // Only where an image the Hub renders actually comes from — Clerk's avatars. The starter's
    // own demo host (api.slingacademy.com) was still listed here with no demo left to use it;
    // a remote pattern is permission for this server to fetch and re-serve from that host.
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'img.clerk.com',
        port: ''
      },
      {
        protocol: 'https',
        hostname: 'clerk.com',
        port: ''
      }
    ]
  },
  transpilePackages: ['geist'],
  compiler: {
    // Strips console.log and friends from production builds — but never console.error or .warn.
    //
    // It used to strip everything. A deployed Hub therefore produced no diagnostic output at
    // all: the sign-in recorder, the rate limiter, the storage adapter and the SYRIX AI turn
    // handler all report failures through console.error, and every one of them was compiled
    // away. A fault reported as "it doesn't work" then had nothing behind it to look at, which
    // is the entire reason for keeping logs.
    //
    // Only errors and warnings survive, deliberately. Chatty logging in a request path is a way
    // to write user data somewhere nobody audits, and SYRIX AI in particular must never record
    // what was asked.
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false
  },

  // Applied to every response, pages and API routes alike — see lib/security/headers.ts for
  // what each one is for and why the CSP still carries the two exceptions it does.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  }
};

let configWithPlugins = baseConfig;

// Conditionally enable Sentry configuration
if (!process.env.NEXT_PUBLIC_SENTRY_DISABLED) {
  configWithPlugins = withSentryConfig(configWithPlugins, {
    org: process.env.NEXT_PUBLIC_SENTRY_ORG,
    project: process.env.NEXT_PUBLIC_SENTRY_PROJECT,
    // Only print logs for uploading source maps in CI
    silent: !process.env.CI,

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
    tunnelRoute: '/monitoring',

    // Disable Sentry telemetry
    telemetry: false,

    // Sentry v10: moved under webpack namespace
    webpack: {
      reactComponentAnnotation: {
        enabled: true
      },
      treeshake: {
        removeDebugLogging: true
      }
    },

    // Disable source map upload when org/project are not configured
    sourcemaps: {
      disable: !process.env.NEXT_PUBLIC_SENTRY_ORG || !process.env.NEXT_PUBLIC_SENTRY_PROJECT
    }
  });
}

const nextConfig = configWithPlugins;
export default nextConfig;
