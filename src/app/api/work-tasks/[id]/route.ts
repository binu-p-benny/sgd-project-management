import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { notifyBlockedWorkReady } from "@/lib/notify-events";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  taskLabel: z.string().trim().min(1).optional(),
  plannedDate: z.string().datetime().optional(),
  actualDate: dateOrNull,
  qcPassed: z.boolean().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * Records progress against one work row — actual date, note, and (only for a row created with
 * isPassFail) the pass/fail outcome — plus, unlike PATCH /api/service-items/[id], lets the same
 * department correct their own taskLabel/plannedDate after the fact (a typo'd task name or a
 * planned date that turns out wrong shouldn't mean deleting the row and starting over). department
 * and isPassFail are still fixed at creation — changing who owns a row or whether it needs a
 * pass/fail outcome is an admin-editor-only concern via a proper reassignment, not a PATCH here.
 * Open to an admin editor or to the department the row was assigned to, same "your department's
 * own step" rule as PATCH /api/phase-steps/[id].
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const task = await prisma.workTask.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Work row not found" }, { status: 404 });
  }

  if (!isAdminEditor(session) && session.department !== task.department) {
    return NextResponse.json({ error: "Forbidden — not your department's row" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Clearing actualDate back to empty is a revert — qcPassed resets with it, same coupling as
  // ServiceItem's own actualDate/qcPassed handling.
  const { actualDate, qcPassed, plannedDate, ...rest } = parsed.data;
  const newQcPassed = actualDate === null ? null : qcPassed;
  const updated = await prisma.workTask.update({
    where: { id },
    data: {
      ...rest,
      actualDate,
      qcPassed: newQcPassed,
      ...(plannedDate !== undefined ? { plannedDate: new Date(plannedDate) } : {}),
    },
  });

  // Completing a row can be the one that finishes a "Blocked work" block — no-ops for every
  // other kind of edit and every block that still has something outstanding.
  if (updated.actualDate) {
    await notifyBlockedWorkReady(updated.workBlockId, session.userId);
  }

  return NextResponse.json(updated);
}
