import type { Department, ItemType, VisitUrgency } from "@prisma/client";
import { updateStepStatus, syncDerivedStepStatus, syncGlassPOStepStatus } from "@/lib/step-actions";
import { computeExpectedArrivalDate } from "@/lib/procurement";
import { prisma, getStep } from "./db";

/** Drives a fresh project through 1A->1D completion. Not for visitUrgency = site_not_ready (1B auto-blocks). */
export async function advanceThroughPhase1(
  projectId: string,
  users: Record<Department, string>,
  urgency: Exclude<VisitUrgency, "site_not_ready"> = "emergency"
) {
  const oneA = await getStep(projectId, "1A");
  await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: urgency });
  const oneB = await getStep(projectId, "1B");
  await updateStepStatus(oneB.id, "completed", users.design_engineer);
  const oneC = await getStep(projectId, "1C");
  await updateStepStatus(oneC.id, "completed", users.design_engineer);
  const oneD = await getStep(projectId, "1D");
  await updateStepStatus(oneD.id, "completed", users.accounts);
}

/** Mimics PATCH /api/procurement-items/:id: updates the row, then resyncs 2A, 2D1 and 2F. */
export async function patchProcurementItem(
  projectId: string,
  itemType: ItemType,
  userId: string,
  data: Partial<{
    requirementCreatedAt: Date | null;
    quoteCreatedAt: Date | null;
    paymentSettledAt: Date | null;
    orderConfirmedAt: Date | null;
    materialDespatchAt: Date | null; // section only
    arrivedForPowderCoatingAt: Date | null; // section only
    actualArrivalDate: Date | null;
    qcCheckedAt: Date | null;
    qcPassed: boolean | null;
  }>
) {
  const item = await prisma.procurementItem.findFirstOrThrow({ where: { projectId, itemType } });
  const { requirementCreatedAt, qcCheckedAt, qcPassed, ...rest } = data;
  const updateData: Record<string, unknown> = { ...rest };
  if (requirementCreatedAt !== undefined) {
    updateData.requirementCreatedAt = requirementCreatedAt;
    updateData.expectedArrivalDate = requirementCreatedAt
      ? computeExpectedArrivalDate(itemType, requirementCreatedAt)
      : null;
  }
  if (qcCheckedAt !== undefined) {
    updateData.qcCheckedAt = qcCheckedAt;
    updateData.qcChecked = qcCheckedAt !== null;
    updateData.qcCheckedBy = qcCheckedAt ? userId : null;
    // Callers that only set qcCheckedAt (the common case, mirroring most existing tests) mean
    // "checked and passed" unless they say otherwise — same default the UI's Pass button
    // bundles into one action. An explicit qcPassed always wins.
    updateData.qcPassed = qcPassed !== undefined ? qcPassed : qcCheckedAt ? true : null;
  } else if (qcPassed !== undefined) {
    updateData.qcPassed = qcPassed;
  }
  await prisma.procurementItem.update({ where: { id: item.id }, data: updateData });
  await syncDerivedStepStatus(projectId, "2A", userId);
  await syncDerivedStepStatus(projectId, "2D1", userId);
  await syncDerivedStepStatus(projectId, "2F", userId);
}

const ITEM_TYPES: ItemType[] = ["section", "hardware", "gasket"];

/** Sets all 3 items' requirement-created date to now — drives 2A to completed. */
export async function markAllRequirementsCreated(projectId: string, userId: string) {
  for (const itemType of ITEM_TYPES) {
    await patchProcurementItem(projectId, itemType, userId, { requirementCreatedAt: new Date() });
  }
}

/** Mimics PATCH /api/glass-purchase-orders/:id filling in all 4 stages — completes 3A. */
export async function completeGlassPO(projectId: string, userId: string) {
  const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId } });
  await prisma.glassPurchaseOrder.update({
    where: { id: glassPO.id },
    data: {
      requirementCreatedAt: new Date(),
      quoteCreatedAt: new Date(),
      paymentSettledAt: new Date(),
      orderConfirmedAt: new Date(),
    },
  });
  await syncGlassPOStepStatus(projectId, userId);
}

/** Mimics filling in the Glass PO tracker's "Actual arrival" row — completes 3B (Glass
 *  delivery), which is derived from it the same way 3A is derived from completeGlassPO's fields.
 *  3B can no longer be completed via updateStepStatus directly (see step-actions.ts). */
export async function completeGlassDelivery(projectId: string, userId: string) {
  const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId } });
  await prisma.glassPurchaseOrder.update({
    where: { id: glassPO.id },
    data: { actualArrivalDate: new Date() },
  });
  await syncGlassPOStepStatus(projectId, userId);
}

/** Sets all 3 requirement dates (completing 2A), then marks all 3 items arrived + QC checked. */
export async function advanceThroughPhase2(projectId: string, users: Record<Department, string>) {
  await markAllRequirementsCreated(projectId, users.design_engineer);

  for (const itemType of ITEM_TYPES) {
    await patchProcurementItem(projectId, itemType, users.purchase, { actualArrivalDate: new Date() });
  }
  for (const itemType of ITEM_TYPES) {
    await patchProcurementItem(projectId, itemType, users.purchase, { qcCheckedAt: new Date() });
  }
}
