import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { clientStaff, clients } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { canViewClient } from '@/lib/permissions/client-access';
import { ForbiddenError, requireActiveEmployee } from '@/lib/permissions/current-employee';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let caller;
  try {
    caller = await requireActiveEmployee();
  } catch (err) {
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    throw err;
  }

  const [target] = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const [staffRow] = await db
    .select({ id: clientStaff.id })
    .from(clientStaff)
    .where(and(eq(clientStaff.clientId, id), eq(clientStaff.employeeId, caller.id)))
    .limit(1);
  const callerIsStaffed = !!staffRow;

  if (!canViewClient(caller, { id: target.id, team: target.team }, callerIsStaffed)) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'client_viewed',
      resourceType: 'client',
      resourceId: id,
      result: 'denied'
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'client_viewed',
    resourceType: 'client',
    resourceId: id,
    result: 'success'
  });

  return NextResponse.json({
    id: target.id,
    name: target.name,
    serviceLine: target.serviceLine,
    team: target.team,
    status: target.status
  });
}
