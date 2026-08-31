import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { syncGlassPOStepStatus } from "@/lib/step-actions";
import { resolveGlassPurchaseOrderFromActionItem } from "@/lib/glass";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  actualDate: dateOrNull,
  qcPassed: z.boolean().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * Records progress against one custom action-plan row under the glass PO — actual date, note,
 * and (only for a row created with isPassFail) the pass/fail outcome; taskLabel/department/
 * isPassFail are fixed at creation. Mirrors /api/procurement-action-items/[id] exactly, just
 * scoped to GlassActionItem — including the Pass-resolves-the-parent's-QC propagation.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorized = isAdminEditor(session) || session.department === "purchase";
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's field" }, { status: 403 });
  }

  const { id } = await params;
  const actionItem = await prisma.glassActionItem.findUnique({
    where: { id },
    include: { glassPurchaseOrder: true },
  });
  if (!actionItem) {
    return NextResponse.json({ error: "Action item not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Clearing actualDate back to empty is a revert — qcPassed resets with it, same as the fixed
  // "qc" stage's own qcCheckedAt/qcPassed coupling in /api/glass-purchase-orders/[id].
  const { actualDate, qcPassed, ...rest } = parsed.data;
  const newQcPassed = actualDate === null ? null : qcPassed;
  const updated = await prisma.glassActionItem.update({
    where: { id },
    data: { ...rest, actualDate, qcPassed: newQcPassed },
  });

  // A genuine Pass on a pass/fail row resolves the glass PO's own QC failure — see
  // resolveGlassPurchaseOrderFromActionItem for the full rationale.
  const resolved = await resolveGlassPurchaseOrderFromActionItem(
    actionItem.glassPurchaseOrderId,
    actionItem.isPassFail,
    newQcPassed ?? null,
    actualDate ?? null
  );
  if (resolved) {
    await syncGlassPOStepStatus(actionItem.glassPurchaseOrder.projectId, session.userId);
  }

  return NextResponse.json(updated);
}
