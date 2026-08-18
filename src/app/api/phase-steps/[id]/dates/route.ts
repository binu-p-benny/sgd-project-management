import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { rescheduleProjectDates } from "@/lib/reschedule";
import { cascadeActualStart } from "@/lib/step-actions";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateDatesSchema = z.object({
  actualStartDate: dateOrNull,
  actualEndDate: dateOrNull,
  note: z.string().optional(),
});

/**
 * Direct actual-date overrides on a step — an admin-only escape hatch (owner_admin
 * or HR & Admin) for correcting history by hand, e.g. backfilling or fixing a
 * data-entry mistake. Planned dates are fully system-computed and can't be edited
 * here (or anywhere) — see step-template.ts/reschedule.ts. Regular department
 * PATCH /api/phase-steps/:id never touches these fields either; status transitions
 * are what normally drive actual dates. Any edit here triggers a project-wide
 * reschedule so downstream planned dates stay consistent with the new actual end date.
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
    return NextResponse.json({ error: "Forbidden — only owner_admin and HR & Admin can edit dates directly" }, { status: 403 });
  }

  const { id } = await params;
  const step = await prisma.phaseStep.findUnique({ where: { id } });
  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateDatesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { note, ...dateFields } = parsed.data;
  if (Object.keys(dateFields).length === 0) {
    return NextResponse.json({ error: "No date fields provided" }, { status: 400 });
  }

  const updated = await prisma.phaseStep.update({
    where: { id },
    data: { ...dateFields, notes: note !== undefined ? note : undefined },
  });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: id,
      changedByUserId: session.userId,
      oldStatus: step.status,
      newStatus: step.status,
      reason: note ? `Dates manually adjusted — ${note}` : "Dates manually adjusted by admin",
    },
  });

  if (dateFields.actualEndDate) {
    await cascadeActualStart(step.projectId, step.stepCode, dateFields.actualEndDate, session.userId);
  }

  await rescheduleProjectDates(step.projectId);

  const refreshed = await prisma.phaseStep.findUnique({ where: { id } });
  return NextResponse.json(refreshed ?? updated);
}
