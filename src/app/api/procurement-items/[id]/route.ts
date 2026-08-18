import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { syncDerivedStepStatus } from "@/lib/step-actions";
import { computeExpectedArrivalDate } from "@/lib/procurement";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  requirementCreatedAt: dateOrNull,
  requirementNote: z.string().nullable().optional(),
  quoteCreatedAt: dateOrNull,
  quoteNote: z.string().nullable().optional(),
  orderConfirmedAt: dateOrNull,
  orderNote: z.string().nullable().optional(),
  paymentSettledAt: dateOrNull,
  paymentNote: z.string().nullable().optional(),
  paymentDetails: z.string().nullable().optional(),
  actualArrivalDate: dateOrNull,
  arrivalNote: z.string().nullable().optional(),
  qcCheckedAt: dateOrNull,
  qcPassed: z.boolean().nullable().optional(),
  qcNote: z.string().nullable().optional(),
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

  // Procurement (quote/order/payment/arrival/QC) is Purchase's domain, but the
  // "Requirement created" row is 2A's own gate and 2A belongs to Design Engineer —
  // so a request touching only that row's date and/or note is authorized for them too.
  const touchedFields = Object.keys(parsed.data);
  const isRequirementOnlyUpdate = touchedFields.every(
    (k) => k === "requirementCreatedAt" || k === "requirementNote"
  );
  const authorized =
    isAdminEditor(session) ||
    session.department === "purchase" ||
    (isRequirementOnlyUpdate && session.department === "design_engineer");
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

  await syncDerivedStepStatus(item.projectId, "2A", session.userId);
  await syncDerivedStepStatus(item.projectId, "2D1", session.userId);
  await syncDerivedStepStatus(item.projectId, "2F", session.userId);

  return NextResponse.json(updated);
}
