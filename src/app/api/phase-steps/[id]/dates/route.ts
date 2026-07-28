import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { rescheduleProjectDates } from "@/lib/reschedule";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateDatesSchema = z.object({
  plannedStartDate: dateOrNull,
  plannedEndDate: dateOrNull,
  actualStartDate: dateOrNull,
  actualEndDate: dateOrNull,
  plannedDurationDays: z.number().int().min(0).nullable().optional(),
  note: z.string().optional(),
});

/**
 * Direct date/duration overrides on a step — an admin-only escape hatch (owner_admin
 * or HR & Admin) for correcting dates by hand, e.g. backfilling history or fixing a
 * data-entry mistake. Regular department PATCH /api/phase-steps/:id never touches
 * these fields; status transitions are what normally drive dates. Any edit here
 * triggers a project-wide reschedule so every not-yet-completed downstream step's
 * planned dates stay consistent with the new anchor.
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

  await rescheduleProjectDates(step.projectId, step.stepCode);

  const refreshed = await prisma.phaseStep.findUnique({ where: { id } });
  return NextResponse.json(refreshed ?? updated);
}
