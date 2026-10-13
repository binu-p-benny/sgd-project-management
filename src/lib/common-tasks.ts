import { prisma } from "@/lib/prisma";
import type { Department, RecurrenceFrequency } from "@prisma/client";
import { addDays } from "@/lib/step-template";
import { addWorkingDays, rollToWorkingDay } from "@/lib/working-days";

export interface CommonTaskRow {
  id: string;
  taskLabel: string;
  department: Department;
  recurrence: RecurrenceFrequency;
  plannedDate: string;
  lastCompletedAt: string | null;
  lastCompletionNote: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: string;
}

/**
 * Advances a recurring CommonTask's own plannedDate by one cycle of its recurrence, starting
 * from whichever of plannedDate/anchor is later — completing (or skipping) a weekly chore a day
 * late still lands the next one on the following week's date rather than immediately re-showing
 * it as due again. Shared by both a completion and a skip (see PATCH /api/common-tasks/[id]):
 * completing passes the actual completion time as `anchor`, skipping passes "now". `recurrence:
 * "none"` is never passed here — that case never advances, it just closes.
 *
 * Never lands on a Sunday (see working-days.ts): a daily chore's next cycle is the next *working*
 * day (Saturday's comes back Monday), while weekly/monthly keep their own weekday/date and only
 * move to the Monday if that falls on a Sunday.
 */
export function nextRecurrenceDate(plannedDate: Date, anchor: Date, recurrence: RecurrenceFrequency): Date {
  const base = plannedDate > anchor ? plannedDate : anchor;
  if (recurrence === "daily") return addWorkingDays(base, 1);
  if (recurrence === "weekly") return rollToWorkingDay(addDays(base, 7));
  // monthly
  const next = new Date(base);
  next.setMonth(next.getMonth() + 1);
  return rollToWorkingDay(next);
}

/**
 * Every CommonTask still being tracked (soft-deleted rows excluded), for the admin-only
 * /common-tasks management list — unlike buildCommonTaskTasks in unified-tasks.ts, this includes
 * ones already completed for their current cycle, since an admin managing the list needs to see
 * everything, not just what's open today.
 */
export async function listCommonTasks(): Promise<CommonTaskRow[]> {
  const rows = await prisma.commonTask.findMany({
    where: { deletedAt: null },
    include: { createdBy: { select: { name: true } } },
    orderBy: [{ department: "asc" }, { plannedDate: "asc" }],
  });

  return rows.map((row) => ({
    id: row.id,
    taskLabel: row.taskLabel,
    department: row.department,
    recurrence: row.recurrence,
    plannedDate: row.plannedDate.toISOString(),
    lastCompletedAt: row.lastCompletedAt?.toISOString() ?? null,
    lastCompletionNote: row.lastCompletionNote,
    note: row.note,
    createdByName: row.createdBy?.name ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}
