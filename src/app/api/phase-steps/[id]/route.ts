import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BlockedReason, DelayCategory, StepStatus, VisitUrgency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { StepActionError, updateStepStatus } from "@/lib/step-actions";
import { notifyStepQcFailed } from "@/lib/notify-events";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  status: z.nativeEnum(StepStatus).optional(),
  blockedReason: z.nativeEnum(BlockedReason).optional(),
  blockedNote: z.string().optional(),
  notes: z.string().optional(),
  visitUrgency: z.nativeEnum(VisitUrgency).optional(),
  delayCategory: z.nativeEnum(DelayCategory).optional(),
  // 3E only — see the branch below for why a Fail (qcPassed: false) never carries a status.
  qcPassed: z.boolean().optional(),
  actionPlanAt: dateOrNull,
  actionPlanNote: z.string().nullable().optional(),
  // Optional — lets whoever's completing/starting the step say when it actually happened,
  // bundled into this same status change (see UpdateStepStatusOptions in step-actions.ts).
  // Distinct from the admin-only /api/phase-steps/[id]/dates route, which corrects an
  // already-recorded date after the fact rather than setting it at the moment of the action.
  actualStartDate: z.string().datetime().optional(),
  actualEndDate: z.string().datetime().optional(),
});

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

  const authorized =
    isAdminEditor(session) ||
    session.department === step.owningDepartment ||
    session.department === step.secondaryDepartment;
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's step" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { status, qcPassed, actionPlanAt, actionPlanNote, ...options } = parsed.data;

  // 3E's QC outcome and action plan are plain field edits, not status transitions — a Pass also
  // completes the step (status: "completed" alongside qcPassed: true, routed through
  // updateStepStatus below so the usual gate checks still run), but a Fail deliberately doesn't
  // change status at all: 3E only really finishes once QC actually passes, so a failed check
  // (and its action plan) can be recorded while the step just sits at in_progress — see
  // qcCheckedAt/qcPassed on PhaseStep.
  if (status === undefined) {
    if (qcPassed === undefined && actionPlanAt === undefined && actionPlanNote === undefined) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }
    if (step.stepCode !== "3E") {
      return NextResponse.json({ error: "Only 3E has a QC outcome or action plan to record here" }, { status: 400 });
    }
    if (qcPassed === true) {
      return NextResponse.json(
        { error: 'Passing QC also completes the step — include status: "completed"' },
        { status: 400 }
      );
    }
    if (qcPassed === false) {
      const effectiveNote = options.notes !== undefined ? options.notes : step.notes;
      if (!effectiveNote?.trim()) {
        return NextResponse.json({ error: "A note is required when QC fails" }, { status: 400 });
      }
    }
    // Unconditional, unlike every other note above — the action plan only exists to explain a
    // failure, so being set at all with nothing to say would defeat the point of the row.
    const effectiveActionPlanAt = actionPlanAt !== undefined ? actionPlanAt : step.actionPlanAt;
    if (effectiveActionPlanAt) {
      const effectiveNote = actionPlanNote !== undefined ? actionPlanNote : step.actionPlanNote;
      if (!effectiveNote?.trim()) {
        return NextResponse.json({ error: "A note is required for the action plan" }, { status: 400 });
      }
    }

    const updated = await prisma.phaseStep.update({
      where: { id },
      data: {
        ...(qcPassed !== undefined ? { qcPassed, qcCheckedAt: new Date() } : {}),
        ...(actionPlanAt !== undefined ? { actionPlanAt } : {}),
        ...(actionPlanNote !== undefined ? { actionPlanNote } : {}),
        ...(options.notes !== undefined ? { notes: options.notes } : {}),
      },
    });

    if (qcPassed !== undefined) {
      await prisma.stepStatusLog.create({
        data: {
          phaseStepId: id,
          changedByUserId: session.userId,
          oldStatus: step.status,
          newStatus: step.status,
          reason: `Final QC failed${options.notes ? ` — ${options.notes}` : ""}`,
        },
      });
      // A failure here leaves the step at in_progress, so nothing else in the app announces it.
      await notifyStepQcFailed(id, session.userId);
    }

    return NextResponse.json(updated);
  }

  try {
    const { actualStartDate, actualEndDate, ...rest } = options;
    const updated = await updateStepStatus(id, status, session.userId, {
      ...rest,
      qcPassed,
      actualStartDate: actualStartDate !== undefined ? new Date(actualStartDate) : undefined,
      actualEndDate: actualEndDate !== undefined ? new Date(actualEndDate) : undefined,
    });
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof StepActionError) {
      return NextResponse.json({ error: err.message, detail: err.detail }, { status: err.status });
    }
    throw err;
  }
}
