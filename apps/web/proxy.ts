import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse, type NextRequest } from 'next/server';
import {
  ACCESS_CODE_PATH,
  ACCESS_COOKIE_NAME,
  accessCodeModeEnabled,
  accessSessionIsValid
} from '@/lib/auth/access-code';
import {
  DEVICE_COOKIE_NAME,
  DEVICE_COOKIE_MAX_AGE_SECONDS,
  mintSignedDeviceCookie,
  readSignedDeviceId
} from '@/lib/auth/device-cookie';

/** The one path a host may probe without a session, in either mode. See app/api/health/route.ts. */
const HEALTH_PATH = '/api/health';

// Issues the device cookie that lib/auth/sign-in-events.ts uses to tell a familiar browser from a
// new one, and that the access-code lockout counts attempts against. It happens here rather than
// in a layout because a Server Component cannot write a cookie — Next.js throws on the attempt —
// so a layout that tried would mint a fresh id on every request and report every sign-in as a new
// device. Next.js 16 runs this file on Node.js (there is no Edge option for a proxy), so the HMAC
// inside is the same node:crypto code path the rest of the app's signing uses.
function withDeviceCookie(request: NextRequest, response?: NextResponse): NextResponse {
  if (readSignedDeviceId(request.cookies.get(DEVICE_COOKIE_NAME)?.value)) {
    return response ?? NextResponse.next();
  }

  const value = mintSignedDeviceCookie();

  // Set on the request as well as the response: without this the cookie only exists from the
  // *next* request onwards, and anything running later in this same request would see no device
  // at all.
  request.cookies.set(DEVICE_COOKIE_NAME, value);
  const result = response ?? NextResponse.next({ request });
  result.cookies.set(DEVICE_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS
  });
  return result;
}

/**
 * The gate for a deployment running on a shared access code (lib/auth/access-code.ts).
 *
 * Clerk is not consulted at all in this mode, which is the point: a development Clerk instance
 * accepts sign-up from any origin, so leaving its routes reachable behind a code would mean the
 * code guards the front door while /auth/sign-up stands open beside it. Everything Clerk serves
 * is therefore sent back to the code screen, session or no session.
 */
function accessCodeGate(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (pathname === ACCESS_CODE_PATH) {
    return withDeviceCookie(request);
  }

  // Webhooks are inbound instructions from third parties. In this mode there is no Clerk instance
  // to send them and no mailbox reconciliation running, so the only thing an open webhook route
  // could do is accept something nobody asked for.
  if (pathname.startsWith('/api/webhooks')) {
    return new NextResponse(null, { status: 404 }) as NextResponse;
  }

  const authorised = accessSessionIsValid(request.cookies.get(ACCESS_COOKIE_NAME)?.value);

  if (pathname.startsWith('/auth') || pathname === '/onboarding') {
    return withDeviceCookie(
      request,
      NextResponse.redirect(new URL(authorised ? '/dashboard' : ACCESS_CODE_PATH, request.url))
    );
  }

  if (authorised) return withDeviceCookie(request);

  // A redirect to an HTML page is a confusing answer to a fetch. Anything under /api gets a
  // status its caller can act on instead.
  if (pathname.startsWith('/api')) {
    return NextResponse.json({ error: 'Access code required' }, { status: 401 }) as NextResponse;
  }

  const destination = new URL(ACCESS_CODE_PATH, request.url);
  return withDeviceCookie(request, NextResponse.redirect(destination));
}

// Route protection for a normal deployment lives in the /dashboard layout via `auth.protect()`;
// clerkMiddleware() only attaches the auth context to every request.
//
// clerkMiddleware still runs in access-code mode, and deliberately: `<ClerkProvider>` resolves
// its initial state through that context, and without it every page in the app throws rather than
// rendering signed-out. So Clerk stays mounted and unused — the gate runs inside it and turns
// away anything that has not answered the code, including Clerk's own routes, which is what
// makes "unused" true rather than merely intended.
export default clerkMiddleware(async (_auth, request) => {
  // Left out of the device-cookie path as well as the gate. A host probes this every few seconds
  // for the life of the deployment, and each probe arrives without cookies — so every one of them
  // would mint a fresh device id and report itself to sign-in-events as another unfamiliar
  // browser, burying the real ones.
  if (request.nextUrl.pathname === HEALTH_PATH) return NextResponse.next();

  return accessCodeModeEnabled() ? accessCodeGate(request) : withDeviceCookie(request);
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)'
  ]
};
