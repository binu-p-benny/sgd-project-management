import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { MANUAL_PLANNED_DATE_STEP_CODES } from "@/lib/step-actions";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const bodySchema = z.object({ plannedStartDate: dateOrNull, plannedEndDate: dateOrNull });

/**
 * Fills in a MANUAL_PLANNED_DATE_STEP_CODES step's own Planned start/end — reachable by an admin
 * directly (same as /api/phase-steps/[id]/dates always allowed) or, once delegated, by the one
 * department an admin granted it to (see plannedDateEditDepartment,
 * /api/phase-steps/[id]/planned-date-permission). Deliberately its own route rather than folded
 * into /dates: that one is a broad admin-only escape hatch covering actual dates too, and opening
 * it up to a non-admin department wholesale would hand them more than just these two fields.
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
  const step = await prisma.phaseStep.findUnique({ where: { id } });
  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }
  if (!MANUAL_PLANNED_DATE_STEP_CODES.has(step.stepCode)) {
    return NextResponse.json(
      { error: `${step.stepCode}'s planned dates are system-computed and can't be edited directly` },
      { status: 400 }
    );
  }

  const canEdit =
    isAdminEditor(session) ||
    (step.plannedDateEditDepartment !== null && session.department === step.plannedDateEditDepartment);
  if (!canEdit) {
    return NextResponse.json(
      { error: "Forbidden — ask an admin to set these, or to grant your department permission" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.plannedStartDate === undefined && parsed.data.plannedEndDate === undefined) {
    return NextResponse.json({ error: "No date fields provided" }, { status: 400 });
  }

  const updated = await prisma.phaseStep.update({
    where: { id },
    data: {
      ...(parsed.data.plannedStartDate !== undefined ? { plannedStartDate: parsed.data.plannedStartDate } : {}),
      ...(parsed.data.plannedEndDate !== undefined ? { plannedEndDate: parsed.data.plannedEndDate } : {}),
    },
  });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: id,
      changedByUserId: session.userId,
      oldStatus: step.status,
      newStatus: step.status,
      reason: "Planned dates set",
    },
  });

  return NextResponse.json(updated);
}
