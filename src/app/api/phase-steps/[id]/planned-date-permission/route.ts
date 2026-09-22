import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Department } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { DEPARTMENT_LABELS } from "@/lib/labels";
import { MANUAL_PLANNED_DATE_STEP_CODES } from "@/lib/step-actions";

const bodySchema = z.object({ department: z.nativeEnum(Department).nullable() });

/**
 * Admin-only delegation: lets owner_admin/HR & Admin hand a MANUAL_PLANNED_DATE_STEP_CODES step's
 * own Planned start/end over to one department to fill in themselves, instead of it staying an
 * admin-only edit (see /api/phase-steps/[id]/dates). Deliberately separate from that route —
 * granting *who* may plan a step is an admin call, distinct from actually filling the dates in
 * (see /api/phase-steps/[id]/planned-dates, reachable by whichever department this sets). Setting
 * department: null revokes it. Once granted, the step shows up as its own task in that
 * department's /my-tasks (see MANUAL_PLANNED_DATE_STEP_CODES in unified-tasks.ts) until the dates
 * are filled in and locked.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json(
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can grant this" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const step = await prisma.phaseStep.findUnique({ where: { id } });
  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }
  if (!MANUAL_PLANNED_DATE_STEP_CODES.has(step.stepCode)) {
    return NextResponse.json(
      { error: `${step.stepCode}'s planned dates aren't manually set, so there's nothing to delegate` },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.phaseStep.update({
    where: { id },
    data: { plannedDateEditDepartment: parsed.data.department },
  });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: id,
      changedByUserId: session.userId,
      oldStatus: step.status,
      newStatus: step.status,
      reason: parsed.data.department
        ? `Planned-date edit permission granted to ${DEPARTMENT_LABELS[parsed.data.department]}`
        : "Planned-date edit permission revoked",
    },
  });

  return NextResponse.json(updated);
}
