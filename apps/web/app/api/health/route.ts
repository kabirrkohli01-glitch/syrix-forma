import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Liveness check for whatever is hosting this deployment.
 *
 * A platform health check needs one unauthenticated path that answers 200 in every mode this
 * app runs in, and no existing route does: `/auth/sign-in` is a 307 to the code screen under
 * `ACCESS_CODE_MODE`, and `/access-code` is a 404 without it. A host pointed at either one
 * therefore marks a perfectly healthy service unhealthy in one of the two modes and never
 * routes traffic to it.
 *
 * Reports that this process is up and serving, and deliberately nothing else:
 *
 * - **No database, Redis or gateway call.** A health check that depends on them fails whenever
 *   one of them briefly does, and the host responds by restarting a container that was working
 *   — turning a momentary Neon blip into an outage. Readiness of the app's dependencies is a
 *   separate question from whether to kill this process, and `npm run doctor` is what answers it.
 * - **No version, environment, commit or configuration.** This is the one route reachable
 *   without the code or a session, so anything it returns is public. It says "ok" because that
 *   is the whole of what a caller is entitled to know.
 */
export function GET() {
  return NextResponse.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
