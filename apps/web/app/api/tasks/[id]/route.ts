import { db } from '@/lib/db/client';
import { tasks } from '@/lib/db/schema';
import { logAuditEvent } from '@/lib/permissions/audit';
import { canViewTask } from '@/lib/permissions/task-access';
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

  const [target] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!target) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (!canViewTask(caller, { id: target.id, assigneeId: target.assigneeId, team: target.team })) {
    await logAuditEvent({
      actorEmployeeId: caller.id,
      action: 'task_viewed',
      resourceType: 'task',
      resourceId: id,
      result: 'denied'
    });
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  await logAuditEvent({
    actorEmployeeId: caller.id,
    action: 'task_viewed',
    resourceType: 'task',
    resourceId: id,
    result: 'success'
  });

  return NextResponse.json({
    id: target.id,
    title: target.title,
    description: target.description,
    status: target.status,
    priority: target.priority,
    dueDate: target.dueDate,
    team: target.team,
    assigneeId: target.assigneeId,
    clientId: target.clientId,
    projectId: target.projectId
  });
}
