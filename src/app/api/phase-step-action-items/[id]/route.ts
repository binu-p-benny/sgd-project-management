import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  actualDate: dateOrNull,
  qcPassed: z.boolean().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * Records progress against one custom action-plan row under 3E — actual date, note, and (only
 * for a row created with isPassFail) the pass/fail outcome; taskLabel, department and
 * isPassFail itself are all fixed at creation, same as every fixed stage's own Planned column
 * never being editable after the fact. Mirrors /api/procurement-action-items/[id] exactly,
 * minus the "resolve the parent's own QC failure" side effect that only makes sense for a
 * derived step (2F) sitting downstream — 3E has no such downstream gate to resolve; re-checking
 * it is just clicking Pass/Fail on 3E's own TaskCard again.
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
  const actionItem = await prisma.phaseStepActionItem.findUnique({
    where: { id },
    include: { phaseStep: true },
  });
  if (!actionItem) {
    return NextResponse.json({ error: "Action item not found" }, { status: 404 });
  }

  const authorized =
    isAdminEditor(session) ||
    session.department === actionItem.phaseStep.owningDepartment ||
    session.department === actionItem.phaseStep.secondaryDepartment;
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's step" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Clearing actualDate back to empty is a revert — qcPassed resets with it, same as 3E's own
  // qcCheckedAt/qcPassed coupling in /api/phase-steps/[id].
  const { actualDate, qcPassed, ...rest } = parsed.data;
  const newQcPassed = actualDate === null ? null : qcPassed;
  const updated = await prisma.phaseStepActionItem.update({
    where: { id },
    data: { ...rest, actualDate, qcPassed: newQcPassed },
  });

  return NextResponse.json(updated);
}
