import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { rescheduleProjectDates } from "@/lib/reschedule";
import { cascadeActualStart, DERIVED_STEP_CODES, MANUAL_PLANNED_DATE_STEP_CODES } from "@/lib/step-actions";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateDatesSchema = z.object({
  actualStartDate: dateOrNull,
  actualEndDate: dateOrNull,
  plannedStartDate: dateOrNull,
  plannedEndDate: dateOrNull,
  note: z.string().optional(),
});

/**
 * Direct date overrides on a step — an admin-only escape hatch (owner_admin or HR & Admin) for
 * correcting history by hand, e.g. backfilling or fixing a data-entry mistake, plus 3C1/3C2/3E's
 * own manual Planned dates (see MANUAL_PLANNED_DATE_STEP_CODES and its Save CTA in TaskCard.tsx).
 * Every other step's planned dates are fully system-computed and stay rejected here — see
 * step-template.ts/reschedule.ts. Regular department PATCH /api/phase-steps/:id never touches
 * any of these fields either; status transitions are what normally drive actual dates. Any edit
 * here triggers a project-wide reschedule so downstream planned dates (Phase 1/2 only — Phase 3
 * never gets one) stay consistent with the new actual end date. 2A/2D1/2F (DERIVED_STEP_CODES)
 * are rejected outright — their actual dates come only from procurement_items via
 * syncDerivedStepStatus, so a manual date here would just be a stray value nothing else reads,
 * sitting inconsistently alongside the real derivation. 3C1's contractor is a separate, non-admin
 * action now — see POST /api/phase-steps/[id]/contractor — not part of this route at all.
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
  if (DERIVED_STEP_CODES.has(step.stepCode)) {
    return NextResponse.json(
      { error: `${step.stepCode}'s dates are derived from procurement_items and can't be edited directly` },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = updateDatesSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (
    (parsed.data.plannedStartDate !== undefined || parsed.data.plannedEndDate !== undefined) &&
    !MANUAL_PLANNED_DATE_STEP_CODES.has(step.stepCode)
  ) {
    return NextResponse.json(
      { error: `${step.stepCode}'s planned dates are system-computed and can't be edited directly` },
      { status: 400 }
    );
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
