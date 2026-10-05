import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ASSIGNABLE_DEPARTMENTS, RECURRENCE_OPTIONS } from "@/lib/labels";
import { nextRecurrenceDate } from "@/lib/common-tasks";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  taskLabel: z.string().trim().min(1).max(200).optional(),
  department: z.enum(ASSIGNABLE_DEPARTMENTS).optional(),
  recurrence: z.enum(RECURRENCE_OPTIONS).optional(),
  plannedDate: z.string().datetime().optional(),
  actualDate: dateOrNull,
  note: z.string().nullable().optional(),
});

/**
 * Records progress on a common task, or (admin editors only) edits it. Open to an admin editor
 * or to the department it was assigned to — same rule as PATCH /api/follow-ups/[id], which is
 * what lets a department close one from /my-tasks.
 *
 * Completing a `recurrence: "none"` task behaves exactly like a follow-up: actualDate gets set
 * and it drops out of the open list for good. Completing anything else instead advances
 * plannedDate to its next cycle (see nextRecurrenceDate) and resets actualDate to null, so the
 * row simply reopens for next time rather than closing — lastCompletedAt records that it happened.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const task = await prisma.commonTask.findFirst({ where: { id, deletedAt: null } });
  if (!task) {
    return NextResponse.json({ error: "Common task not found" }, { status: 404 });
  }

  const admin = isAdminEditor(session);
  if (!admin && session.department !== task.department) {
    return NextResponse.json({ error: "Forbidden — not your department's task" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { taskLabel, department, recurrence, plannedDate, actualDate, note } = parsed.data;

  // Renaming, reassigning, rescheduling or changing the cadence is an admin-editor call, same
  // carve-out as a follow-up's own PATCH — the department that owns this can record what
  // happened, not redefine the job.
  if (!admin && (taskLabel !== undefined || department !== undefined || recurrence !== undefined || plannedDate !== undefined)) {
    return NextResponse.json(
      { error: "Forbidden — only an admin editor can rename, reschedule or reassign a common task" },
      { status: 403 }
    );
  }

  const data: Record<string, unknown> = {
    ...(taskLabel !== undefined ? { taskLabel } : {}),
    ...(department !== undefined ? { department } : {}),
    ...(recurrence !== undefined ? { recurrence } : {}),
    ...(plannedDate !== undefined ? { plannedDate: new Date(plannedDate) } : {}),
    ...(note !== undefined ? { note } : {}),
  };

  if (actualDate !== undefined) {
    const effectiveRecurrence = recurrence ?? task.recurrence;
    if (actualDate === null || effectiveRecurrence === "none") {
      data.actualDate = actualDate;
      if (actualDate !== null) data.lastCompletedAt = actualDate;
    } else {
      // Completing a recurring task never actually closes it — it just rolls straight to its
      // next cycle (see nextRecurrenceDate's own doc comment on why plannedDate, not just the
      // completion timestamp, anchors that).
      data.plannedDate = nextRecurrenceDate(
        plannedDate !== undefined ? new Date(plannedDate) : task.plannedDate,
        actualDate,
        effectiveRecurrence
      );
      data.actualDate = null;
      data.lastCompletedAt = actualDate;
    }
  }

  const updated = await prisma.commonTask.update({ where: { id }, data });
  return NextResponse.json(updated);
}

/** Retires a common task (soft delete) — admin editors only, same as deleting a follow-up. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json({ error: "Forbidden — only an admin editor can retire a common task" }, { status: 403 });
  }

  const { id } = await params;
  const task = await prisma.commonTask.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
  if (!task) {
    return NextResponse.json({ error: "Common task not found" }, { status: 404 });
  }

  await prisma.commonTask.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
