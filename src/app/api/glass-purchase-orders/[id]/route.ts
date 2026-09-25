import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { syncGlassPOStepStatus } from "@/lib/step-actions";
import { notifyGlassQcFailed } from "@/lib/notify-events";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

// Every xPlannedDate field here is a plain, freeform manual date, unlike /api/procurement-items'
// xPlannedOverride fields — 3A's glass PO tracker never gets a *computed* planned date (see
// GlassPurchaseOrder in schema.prisma), so there's no forecast for these to override.
const updateSchema = z.object({
  requirementCreatedAt: dateOrNull,
  requirementNote: z.string().nullable().optional(),
  requirementPlannedDate: dateOrNull,
  quoteCreatedAt: dateOrNull,
  quoteNote: z.string().nullable().optional(),
  quotePlannedDate: dateOrNull,
  paymentSettledAt: dateOrNull,
  paymentNote: z.string().nullable().optional(),
  paymentPlannedDate: dateOrNull,
  orderConfirmedAt: dateOrNull,
  orderNote: z.string().nullable().optional(),
  orderPlannedDate: dateOrNull,
  actualArrivalDate: dateOrNull,
  arrivalNote: z.string().nullable().optional(),
  arrivalPlannedDate: dateOrNull,
  qcCheckedAt: dateOrNull,
  qcPassed: z.boolean().nullable().optional(),
  qcNote: z.string().nullable().optional(),
  qcPlannedDate: dateOrNull,
  actionPlanAt: dateOrNull,
  actionPlanNote: z.string().nullable().optional(),
});

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const existing = await prisma.glassPurchaseOrder.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Glass purchase order not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Quote/Order/Arrival/QC are Purchase's own domain — same split as /api/procurement-items:
  // "Requirement created" belongs to Design Engineer (2A's own gate), "Payment done" belongs to
  // Accounts. Each row's own Planned date counts as part of that same row for this check.
  const touchedFields = Object.keys(parsed.data);
  const isRequirementOnlyUpdate = touchedFields.every(
    (k) => k === "requirementCreatedAt" || k === "requirementNote" || k === "requirementPlannedDate"
  );
  const isPaymentOnlyUpdate = touchedFields.every(
    (k) => k === "paymentSettledAt" || k === "paymentNote" || k === "paymentPlannedDate"
  );
  const authorized =
    isAdminEditor(session) ||
    session.department === "purchase" ||
    (isRequirementOnlyUpdate && session.department === "design_engineer") ||
    (isPaymentOnlyUpdate && session.department === "accounts");
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's field" }, { status: 403 });
  }

  const { qcCheckedAt, qcPassed, ...otherFields } = parsed.data;

  // What qcPassed will actually be after this write — clearing qcCheckedAt (reverting the check)
  // always resets it to null, since "not checked" has no result; otherwise it's whatever this
  // request sets it to, or the existing value if this request doesn't touch it. Same rule as
  // /api/procurement-items.
  const effectiveQcPassed = qcCheckedAt === null ? null : qcPassed !== undefined ? qcPassed : existing.qcPassed;
  if (effectiveQcPassed === false) {
    const effectiveNote = otherFields.qcNote !== undefined ? otherFields.qcNote : existing.qcNote;
    if (!effectiveNote?.trim()) {
      return NextResponse.json({ error: "A note is required when QC fails" }, { status: 400 });
    }
  }

  // Unconditional, unlike every other stage's note — the action plan only exists to explain a
  // failure, so being set at all with nothing to say would defeat the point of the row.
  if (otherFields.actionPlanAt) {
    const effectiveNote = otherFields.actionPlanNote !== undefined ? otherFields.actionPlanNote : existing.actionPlanNote;
    if (!effectiveNote?.trim()) {
      return NextResponse.json({ error: "A note is required for the action plan" }, { status: 400 });
    }
  }

  const updated = await prisma.glassPurchaseOrder.update({
    where: { id },
    data: {
      ...otherFields,
      ...(qcCheckedAt !== undefined
        ? {
            qcCheckedAt,
            qcCheckedBy: qcCheckedAt ? session.userId : null,
            qcPassed: qcCheckedAt === null ? null : qcPassed,
          }
        : qcPassed !== undefined
          ? { qcPassed }
          : {}),
    },
  });

  // Same "newly failed, deduped on qc_checked_at" rule as the procurement route's own QC branch.
  if (effectiveQcPassed === false) {
    await notifyGlassQcFailed(updated.id, session.userId);
  }

  // 3A's status, actual start (Requirement created) and actual end (Order confirmed) all track
  // this row live — see syncGlassPOStepStatus in step-actions.ts.
  await syncGlassPOStepStatus(existing.projectId, session.userId);

  return NextResponse.json(updated);
}
