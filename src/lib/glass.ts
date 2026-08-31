import { prisma } from "@/lib/prisma";

/**
 * Seeds the (single, per-project) glass PO tracker row, unless one already exists — mirrors
 * seedPhaseSteps's existence check in step-actions.ts: 2F can complete more than once over a
 * project's life (revert, then re-complete), and re-seeding must not wipe out real data already
 * entered against the first row. `projectId` is unique on the model, so upsert with an empty
 * update is the idiomatic idempotent form here (no bulk insert to guard, unlike phase steps).
 */
export async function createEmptyGlassPurchaseOrderForProject(projectId: string): Promise<void> {
  await prisma.glassPurchaseOrder.upsert({
    where: { projectId },
    update: {},
    create: { projectId },
  });
}

/**
 * Same idea as procurement.ts's resolveProcurementItemFromActionItem — a genuine Pass on a
 * pass/fail custom row under the glass PO is that PO's real recheck outcome. See that function's
 * comment for the full rationale; this is the GlassPurchaseOrder/GlassActionItem mirror of it,
 * called from /api/glass-action-items/[id].
 */
export async function resolveGlassPurchaseOrderFromActionItem(
  glassPurchaseOrderId: string,
  isPassFail: boolean,
  newQcPassed: boolean | null,
  resolvedAt: Date | null
): Promise<boolean> {
  if (!isPassFail || newQcPassed !== true) return false;
  const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { id: glassPurchaseOrderId } });
  if (glassPO.qcPassed !== false) return false;
  await prisma.glassPurchaseOrder.update({
    where: { id: glassPurchaseOrderId },
    data: { qcPassed: true, qcCheckedAt: resolvedAt ?? glassPO.qcCheckedAt ?? new Date() },
  });
  return true;
}
