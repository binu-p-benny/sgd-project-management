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
  quoteCreatedAt: dateOrNull,
  orderConfirmedAt: dateOrNull,
  paymentSettledAt: dateOrNull,
  paymentDetails: z.string().nullable().optional(),
  actualArrivalDate: dateOrNull,
  qcCheckedAt: dateOrNull,
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
  // "Requirement created" date is 2A's own gate and 2A belongs to Design Engineer —
  // so a request touching only requirementCreatedAt is authorized for them too.
  const touchedFields = Object.keys(parsed.data);
  const isRequirementOnlyUpdate = touchedFields.every((k) => k === "requirementCreatedAt");
  const authorized =
    isAdminEditor(session) ||
    session.department === "purchase" ||
    (isRequirementOnlyUpdate && session.department === "design_engineer");
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's field" }, { status: 403 });
  }

  const { requirementCreatedAt, qcCheckedAt, ...dateFields } = parsed.data;

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
          }
        : {}),
    },
  });

  await syncDerivedStepStatus(item.projectId, "2A", session.userId);
  await syncDerivedStepStatus(item.projectId, "2D1", session.userId);
  await syncDerivedStepStatus(item.projectId, "2F", session.userId);

  return NextResponse.json(updated);
}
