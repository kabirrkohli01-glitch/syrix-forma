/* Approving or denying one proposed action.
 *
 * The client sends an ID and a verdict. It does not send the action, and it
 * cannot: the proposal and every parameter of it are held server side, so what
 * runs is what was displayed on the card and nothing else.
 *
 * The caller is resolved from the session here, never read from the body, and
 * the broker checks that this employee is the one the proposal was made for.
 * Authorization for the write itself runs again inside the Hub's own server
 * action at execution time — this route authorizes the approval, not the effect.
 */

import { NextResponse } from 'next/server';

import { approve, deny, ProposalError } from '@/lib/ai/hub/actions';
import { ForbiddenError, requireActiveEmployee } from '@/lib/permissions/current-employee';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let caller;
  try {
    caller = await requireActiveEmployee();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    throw err;
  }

  let body: { id?: unknown; verdict?: unknown };
  try {
    body = (await request.json()) as { id?: unknown; verdict?: unknown };
  } catch {
    return NextResponse.json({ error: 'Malformed request.' }, { status: 400 });
  }

  const id = typeof body.id === 'string' ? body.id : '';
  const verdict = body.verdict === 'approve' ? 'approve' : body.verdict === 'deny' ? 'deny' : null;

  if (!id || !verdict) {
    return NextResponse.json({ error: 'Say which request, and whether to go ahead.' }, { status: 400 });
  }

  if (verdict === 'deny') {
    await deny(id, caller);
    return NextResponse.json({ ok: true, message: 'Left alone — nothing was changed.' });
  }

  try {
    const result = await approve(id, caller);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ProposalError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
