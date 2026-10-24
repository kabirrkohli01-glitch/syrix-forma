import { db } from '@/lib/db/client';
import { employees } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { canViewEmployeeRecord } from '@/lib/permissions/employee-access';
import { ForbiddenError, requireActiveEmployee } from '@/lib/permissions/current-employee';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

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

  const [target] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canViewEmployeeRecord(caller, { id: target.id, team: target.team })) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'employee_record_view',
      resourceType: 'employee',
      resourceId: id,
      result: 'denied'
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'employee_record_view',
    resourceType: 'employee',
    resourceId: id,
    result: 'success'
  });

  return NextResponse.json({
    id: target.id,
    name: target.name,
    email: target.email,
    role: target.role,
    team: target.team,
    status: target.status
  });
}
