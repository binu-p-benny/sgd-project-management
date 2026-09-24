"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "@/components/ui/Spinner";
import { ASSIGNABLE_DEPARTMENTS, DEPARTMENT_LABELS } from "@/lib/labels";
import type { Department } from "@prisma/client";

export interface BlockedWorkTaskDraft {
  taskLabel: string;
  department: Department;
  plannedDate: string;
}

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

const fieldCls =
  "h-9 w-full min-w-0 rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

/**
 * Opens from the block panel's "Confirm block" — the chance to line up follow-up work (a
 * "Blocked work" block, see WorkBlock.blockedPhaseStepId) aimed at getting the step unblocked,
 * before the block is actually recorded. Tasks are optional: "Block without tasks" is a first-class
 * outcome, and /projects' Status column simply reads "no tasks" for it. Owns only its own draft
 * rows; the caller does the actual block + task creation, and reports failure back through `error`.
 */
export function BlockedWorkModal({
  stepLabel,
  reasonText,
  submitting,
  error,
  onCancel,
  onConfirm,
}: {
  stepLabel: string;
  reasonText: string;
  submitting: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (tasks: BlockedWorkTaskDraft[]) => void;
}) {
  const [rows, setRows] = useState<BlockedWorkTaskDraft[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);

  function update(i: number, patch: Partial<BlockedWorkTaskDraft>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function confirm() {
    if (rows.some((r) => !r.taskLabel.trim() || !r.plannedDate)) {
      setLocalError("Give every task a name and a planned date, or remove the empty row");
      return;
    }
    setLocalError(null);
    onConfirm(rows.map((r) => ({ ...r, taskLabel: r.taskLabel.trim() })));
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={submitting ? undefined : onCancel}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-xl border border-edge bg-surface p-5 shadow-[var(--shadow-sm)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-fg">Block {stepLabel}</h3>
            <span className="rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
              Blocked work tasks
            </span>
          </div>
          <p className="text-xs text-fg-muted">{reasonText}</p>
          <p className="text-xs text-fg-muted">
            Add the tasks needed to resolve this block — they&apos;re tracked under Additional works, and /projects shows how
            many are done. Optional.
          </p>
        </div>

        <div className="flex flex-col gap-2 overflow-auto">
          {rows.map((row, i) => (
            <div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-edge p-2 sm:grid-cols-[1fr_9rem_9rem_auto]">
              <input
                className={fieldCls}
                placeholder="Task"
                value={row.taskLabel}
                disabled={submitting}
                onChange={(e) => update(i, { taskLabel: e.target.value })}
              />
              <select
                className={fieldCls}
                value={row.department}
                disabled={submitting}
                onChange={(e) => update(i, { department: e.target.value as Department })}
              >
                {ASSIGNABLE_DEPARTMENTS.map((d) => (
                  <option key={d} value={d}>
                    {DEPARTMENT_LABELS[d]}
                  </option>
                ))}
              </select>
              <input
                type="date"
                className={fieldCls}
                value={row.plannedDate}
                disabled={submitting}
                onChange={(e) => update(i, { plannedDate: e.target.value })}
              />
              <button
                type="button"
                disabled={submitting}
                onClick={() => setRows((prev) => prev.filter((_, idx) => idx !== i))}
                className="h-9 rounded-lg border border-edge px-2.5 text-xs font-medium text-fg-muted hover:text-red-600 disabled:opacity-40"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={submitting}
            onClick={() => setRows((prev) => [...prev, { taskLabel: "", department: "purchase", plannedDate: todayInput() }])}
            className="self-start text-xs font-medium text-accent hover:underline disabled:opacity-40"
          >
            + Add task
          </button>
        </div>

        {(localError || error) && (
          <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
            {localError ?? error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            className="flex h-9 items-center rounded-lg border border-edge px-3 text-xs font-medium text-fg-muted hover:text-fg disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={submitting}
            className="flex h-9 items-center rounded-lg bg-accent px-4 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-40"
          >
            {submitting ? (
              <Spinner className="h-3.5 w-3.5" />
            ) : rows.length === 0 ? (
              "Block without tasks"
            ) : (
              `Block with ${rows.length} task${rows.length === 1 ? "" : "s"}`
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
