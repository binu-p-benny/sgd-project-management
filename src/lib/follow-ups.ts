import { prisma } from "@/lib/prisma";
import type { Department } from "@prisma/client";

/**
 * Follow-ups raised from the project detail page. Each one hangs off exactly one card — a phase
 * step, one procurement item's tracker, or the Glass PO tracker — and is counted on that card's
 * own "Follow ups" button (see FollowUpsButton.tsx). The Site QC table has no anchor of its own:
 * it belongs to 3E, so its follow-ups anchor on that step.
 */

export type FollowUpAnchorKind = "phase_step" | "procurement_item" | "glass_po";

export interface FollowUpAnchor {
  kind: FollowUpAnchorKind;
  id: string;
  /** What the card is called, for the modal heading and the page's own follow-ups list. */
  label: string;
}

export interface FollowUpRow {
  id: string;
  taskLabel: string;
  department: Department;
  plannedDate: string;
  actualDate: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

/** The shape the anchor columns take in a query — exactly one is set. */
export function anchorWhere(anchor: Pick<FollowUpAnchor, "kind" | "id">) {
  if (anchor.kind === "phase_step") return { phaseStepId: anchor.id };
  if (anchor.kind === "procurement_item") return { procurementItemId: anchor.id };
  return { glassPurchaseOrderId: anchor.id };
}

/** Stable key for grouping rows by the card they came from, client- and server-side alike. */
export function anchorKey(anchor: Pick<FollowUpAnchor, "kind" | "id">): string {
  return `${anchor.kind}:${anchor.id}`;
}

const SELECT = {
  id: true,
  taskLabel: true,
  department: true,
  plannedDate: true,
  actualDate: true,
  note: true,
  createdAt: true,
  phaseStepId: true,
  procurementItemId: true,
  glassPurchaseOrderId: true,
  createdBy: { select: { name: true } },
} as const;

type Selected = {
  id: string;
  taskLabel: string;
  department: Department;
  plannedDate: Date;
  actualDate: Date | null;
  note: string | null;
  createdAt: Date;
  phaseStepId: string | null;
  procurementItemId: string | null;
  glassPurchaseOrderId: string | null;
  createdBy: { name: string } | null;
};

function toRow(row: Selected): FollowUpRow {
  return {
    id: row.id,
    taskLabel: row.taskLabel,
    department: row.department,
    plannedDate: row.plannedDate.toISOString(),
    actualDate: row.actualDate?.toISOString() ?? null,
    note: row.note,
    createdByName: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function rowAnchorKey(row: Pick<Selected, "phaseStepId" | "procurementItemId" | "glassPurchaseOrderId">): string {
  if (row.phaseStepId) return anchorKey({ kind: "phase_step", id: row.phaseStepId });
  if (row.procurementItemId) return anchorKey({ kind: "procurement_item", id: row.procurementItemId });
  return anchorKey({ kind: "glass_po", id: row.glassPurchaseOrderId! });
}

/**
 * Every follow-up on a project, keyed by the card it belongs to — one query for the whole page,
 * rather than one per card. Oldest first inside each card, so a card's list reads in the order
 * the follow-ups were raised.
 */
export async function getProjectFollowUps(projectId: string): Promise<Record<string, FollowUpRow[]>> {
  const rows = await prisma.followUpTask.findMany({
    where: { projectId },
    orderBy: { createdAt: "asc" },
    select: SELECT,
  });

  const byAnchor: Record<string, FollowUpRow[]> = {};
  for (const row of rows) {
    const key = rowAnchorKey(row);
    (byAnchor[key] ??= []).push(toRow(row));
  }
  return byAnchor;
}
