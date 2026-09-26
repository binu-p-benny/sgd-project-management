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

export interface DepartmentFollowUp extends FollowUpRow {
  projectId: string;
  projectName: string;
  /** The card it was raised from, worded as the project page words it. */
  anchorLabel: string;
}

/** How far back the drawer still shows something already closed. */
const RECENTLY_DONE_DAYS = 30;

/**
 * One department's follow-ups for the /my-tasks drawer — everything still open, plus whatever
 * it closed in the last month so a "did I already do that?" check doesn't need the project page.
 * Open ones first, each by planned date; closed ones after, most recently closed first.
 *
 * A null department (nobody signed in, or a session without one) gets nothing rather than
 * everything — this is a personal list, not an admin view.
 */
export async function getDepartmentFollowUps(department: Department | null): Promise<DepartmentFollowUp[]> {
  if (!department) return [];

  const since = new Date(Date.now() - RECENTLY_DONE_DAYS * 86_400_000);
  const rows = await prisma.followUpTask.findMany({
    where: {
      department,
      OR: [{ actualDate: null }, { actualDate: { gte: since } }],
    },
    select: {
      ...SELECT,
      project: { select: { id: true, name: true } },
      phaseStep: { select: { stepCode: true, stepName: true } },
      procurementItem: { select: { itemType: true } },
    },
  });

  return rows
    .map((row) => ({
      ...toRow(row),
      projectId: row.project.id,
      projectName: row.project.name,
      anchorLabel: row.phaseStep
        ? `${row.phaseStep.stepCode} ${row.phaseStep.stepName}`
        : row.procurementItem
          ? `${row.procurementItem.itemType.charAt(0).toUpperCase()}${row.procurementItem.itemType.slice(1)} procurement`
          : "Glass PO",
    }))
    .sort((a, b) => {
      if (!a.actualDate !== !b.actualDate) return a.actualDate ? 1 : -1;
      if (a.actualDate && b.actualDate) return b.actualDate.localeCompare(a.actualDate);
      return a.plannedDate.localeCompare(b.plannedDate);
    });
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
