import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { syncDerivedStepStatus } from "@/lib/step-actions";
import { computeExpectedArrivalDate } from "@/lib/procurement";
import { rescheduleProjectDates } from "@/lib/reschedule";
import { notifyProcurementQcFailed } from "@/lib/notify-events";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  requirementCreatedAt: dateOrNull,
  requirementNote: z.string().nullable().optional(),
  requirementPlannedOverride: dateOrNull,
  quoteCreatedAt: dateOrNull,
  quoteNote: z.string().nullable().optional(),
  quotePlannedOverride: dateOrNull,
  orderConfirmedAt: dateOrNull,
  orderNote: z.string().nullable().optional(),
  orderPlannedOverride: dateOrNull,
  // Section only — always null on hardware/gasket rows, but no need to reject writes to them on
  // the wrong item type: nothing else ever reads these fields for hardware/gasket, so the value
  // just sits there unused, same as any other stage no one has an opinion on.
  materialDespatchAt: dateOrNull,
  materialDespatchNote: z.string().nullable().optional(),
  materialDespatchPlannedOverride: dateOrNull,
  arrivedForPowderCoatingAt: dateOrNull,
  arrivedForPowderCoatingNote: z.string().nullable().optional(),
  arrivedForPowderCoatingPlannedOverride: dateOrNull,
  paymentSettledAt: dateOrNull,
  paymentNote: z.string().nullable().optional(),
  paymentDetails: z.string().nullable().optional(),
  paymentPlannedOverride: dateOrNull,
  actualArrivalDate: dateOrNull,
  arrivalNote: z.string().nullable().optional(),
  arrivalPlannedOverride: dateOrNull,
  qcCheckedAt: dateOrNull,
  qcPassed: z.boolean().nullable().optional(),
  qcNote: z.string().nullable().optional(),
  qcPlannedOverride: dateOrNull,
  actionPlanAt: dateOrNull,
  actionPlanNote: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
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
  const item = await prisma.procurementItem.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Procurement item not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Procurement (quote/order/despatch/arrival/QC) is Purchase's domain, but two rows belong to
  // other departments: "Requirement created" is 2A's own gate and belongs to Design Engineer,
  // and "Payment done" belongs to Accounts — so a request touching only one of those rows' own
  // date/note/Planned-override fields is authorized for that department too.
  const touchedFields = Object.keys(parsed.data);
  const isRequirementOnlyUpdate = touchedFields.every(
    (k) => k === "requirementCreatedAt" || k === "requirementNote" || k === "requirementPlannedOverride"
  );
  const isPaymentOnlyUpdate = touchedFields.every(
    (k) =>
      k === "paymentSettledAt" || k === "paymentNote" || k === "paymentDetails" || k === "paymentPlannedOverride"
  );
  const authorized =
    isAdminEditor(session) ||
    session.department === "purchase" ||
    (isRequirementOnlyUpdate && session.department === "design_engineer") ||
    (isPaymentOnlyUpdate && session.department === "accounts");
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's field" }, { status: 403 });
  }

  const { requirementCreatedAt, qcCheckedAt, qcPassed, ...dateFields } = parsed.data;

  // What qcPassed will actually be after this write — clearing qcCheckedAt (reverting the
  // check) always resets it to null, since "not checked" has no result; otherwise it's
  // whatever this request sets it to, or the existing value if this request doesn't touch it
  // (e.g. a plain date correction on an already-resolved row).
  const effectiveQcPassed = qcCheckedAt === null ? null : qcPassed !== undefined ? qcPassed : item.qcPassed;
  if (effectiveQcPassed === false) {
    const effectiveNote = dateFields.qcNote !== undefined ? dateFields.qcNote : item.qcNote;
    if (!effectiveNote?.trim()) {
      return NextResponse.json({ error: "A note is required when QC fails" }, { status: 400 });
    }
  }

  // Unconditional, unlike every other stage's note — the action plan only exists to explain a
  // failure, so being set at all with nothing to say would defeat the point of the row.
  if (dateFields.actionPlanAt) {
    const effectiveNote = dateFields.actionPlanNote !== undefined ? dateFields.actionPlanNote : item.actionPlanNote;
    if (!effectiveNote?.trim()) {
      return NextResponse.json({ error: "A note is required for the action plan" }, { status: 400 });
    }
  }

  const updated = await prisma.procurementItem.update({
    where: { id },
    data: {
      ...dateFields,
      ...(requirementCreatedAt !== undefined
        ? {
            requirementCreatedAt,
            expectedArrivalDate: requirementCreatedAt
              ? computeExpectedArrivalDate(item.itemType, requirementCreatedAt)
              : null,
          }
        : {}),
      ...(qcCheckedAt !== undefined
        ? {
            qcCheckedAt,
            qcChecked: qcCheckedAt !== null,
            qcCheckedBy: qcCheckedAt ? session.userId : null,
            qcPassed: qcCheckedAt === null ? null : qcPassed,
          }
        : qcPassed !== undefined
          ? { qcPassed }
          : {}),
    },
  });

  // Newly failed only — a later edit that leaves qcPassed false (a corrected note, say) reuses
  // the same qc_checked_at, which notifyProcurementQcFailed dedupes on.
  if (effectiveQcPassed === false) {
    await notifyProcurementQcFailed(item.id, session.userId);
  }

  await syncDerivedStepStatus(item.projectId, "2A", session.userId);
  await syncDerivedStepStatus(item.projectId, "2D1", session.userId);
  await syncDerivedStepStatus(item.projectId, "2F", session.userId);
  // Unconditional, unlike the sync calls above (which only reschedule as a side effect of a
  // derived step's *status* actually changing) — 2D1's own planned date now tracks the latest
  // of every item's Actual arrival planned date (see rescheduleProjectDates), which this patch
  // can move without ever touching 2A/2D1/2F's status (e.g. editing an Order confirmed date or
  // a planned-date override on an already-in-progress item).
  await rescheduleProjectDates(item.projectId);

  return NextResponse.json(updated);
}
