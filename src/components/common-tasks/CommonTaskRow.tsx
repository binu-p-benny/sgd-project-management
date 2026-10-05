"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Department, RecurrenceFrequency } from "@prisma/client";
import { Spinner } from "@/components/ui/Spinner";
import { ASSIGNABLE_DEPARTMENTS, DEPARTMENT_LABELS, RECURRENCE_OPTIONS, RECURRENCE_LABELS } from "@/lib/labels";
import { RetireCommonTaskButton } from "@/components/common-tasks/RetireCommonTaskButton";

export interface CommonTaskRowData {
  id: string;
  taskLabel: string;
  department: Department;
  recurrence: RecurrenceFrequency;
  plannedDate: string;
  lastCompletedAt: string | null;
  note: string | null;
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
function toDateInputValue(iso: string): string {
  return iso.slice(0, 10);
}

const inputCls =
  "h-9 w-full min-w-0 rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

/**
 * Everything editing a common task *does* — form state, save/cancel — shared by the desktop row
 * and mobile card below so the two layouts can never drift on what PATCH /api/common-tasks/[id]
 * is sent. Mirrors useTaskActions' own editingMeta pattern in TaskTable.tsx (see
 * WorkTaskMetaEditor there), just for every editable field at once rather than just two.
 */
function useCommonTaskEdit(task: CommonTaskRowData) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [taskLabel, setTaskLabel] = useState(task.taskLabel);
  const [department, setDepartment] = useState<Department>(task.department);
  const [recurrence, setRecurrence] = useState<RecurrenceFrequency>(task.recurrence);
  const [plannedDate, setPlannedDate] = useState(toDateInputValue(task.plannedDate));
  const [note, setNote] = useState(task.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setTaskLabel(task.taskLabel);
    setDepartment(task.department);
    setRecurrence(task.recurrence);
    setPlannedDate(toDateInputValue(task.plannedDate));
    setNote(task.note ?? "");
    setError(null);
    setEditing(true);
  }
  function cancelEdit() {
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (!taskLabel.trim() || !plannedDate) {
      setError("Task and due date are both required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/common-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskLabel: taskLabel.trim(),
          department,
          recurrence,
          plannedDate: new Date(plannedDate).toISOString(),
          note: note.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Could not save changes");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      setEditing(false);
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  return {
    editing,
    startEdit,
    cancelEdit,
    taskLabel,
    setTaskLabel,
    department,
    setDepartment,
    recurrence,
    setRecurrence,
    plannedDate,
    setPlannedDate,
    note,
    setNote,
    submitting,
    error,
    save,
  };
}
type Edit = ReturnType<typeof useCommonTaskEdit>;

function EditFields({ e }: { e: Edit }) {
  return (
    <div className="flex flex-col gap-2">
      <input
        value={e.taskLabel}
        onChange={(ev) => e.setTaskLabel(ev.target.value)}
        placeholder="Task"
        className={inputCls}
      />
      <div className="flex gap-2">
        <select
          value={e.department}
          onChange={(ev) => e.setDepartment(ev.target.value as Department)}
          className={inputCls}
        >
          {ASSIGNABLE_DEPARTMENTS.map((d) => (
            <option key={d} value={d}>
              {DEPARTMENT_LABELS[d]}
            </option>
          ))}
        </select>
        <select
          value={e.recurrence}
          onChange={(ev) => e.setRecurrence(ev.target.value as RecurrenceFrequency)}
          className={inputCls}
        >
          {RECURRENCE_OPTIONS.map((r) => (
            <option key={r} value={r}>
              {RECURRENCE_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <input type="date" value={e.plannedDate} onChange={(ev) => e.setPlannedDate(ev.target.value)} className={inputCls} />
      <input
        value={e.note}
        onChange={(ev) => e.setNote(ev.target.value)}
        placeholder="Note (optional)"
        className={inputCls}
      />
      {e.error && <p className="text-[11px] text-red-600 dark:text-red-400">{e.error}</p>}
      <div className="flex justify-end gap-1.5">
        <button
          type="button"
          onClick={e.cancelEdit}
          disabled={e.submitting}
          className="rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={e.save}
          disabled={e.submitting}
          className="flex items-center justify-center rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
        >
          {e.submitting ? <Spinner className="h-3.5 w-3.5" /> : "Save"}
        </button>
      </div>
    </div>
  );
}

function EditPencilButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Edit task"
      title="Edit task"
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-overlay hover:text-fg"
    >
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-3.5 w-3.5 stroke-current">
        <path d="M16.5 4.5 19.5 7.5 8 19H5v-3L16.5 4.5Z" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export function CommonTaskMobileCard({ task }: { task: CommonTaskRowData }) {
  const e = useCommonTaskEdit(task);

  if (e.editing) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 dark:border-violet-500/25 dark:bg-violet-500/[0.04]">
        <EditFields e={e} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-violet-500/30 bg-violet-500/5 p-4 dark:border-violet-500/25 dark:bg-violet-500/[0.04]">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-fg">{task.taskLabel}</span>
        <EditPencilButton onClick={e.startEdit} />
      </div>
      <div className="text-sm text-fg-muted">
        {DEPARTMENT_LABELS[task.department]} · {RECURRENCE_LABELS[task.recurrence]}
      </div>
      <div className="text-sm text-fg-muted">Due {formatDate(task.plannedDate)}</div>
      {task.lastCompletedAt && <div className="text-xs text-fg-subtle">Last done {formatDate(task.lastCompletedAt)}</div>}
      {task.note && <div className="text-xs text-fg-subtle">{task.note}</div>}
      <div className="flex justify-end border-t border-edge pt-2">
        <RetireCommonTaskButton taskId={task.id} taskLabel={task.taskLabel} />
      </div>
    </div>
  );
}

export function CommonTaskDesktopRow({ task }: { task: CommonTaskRowData }) {
  const e = useCommonTaskEdit(task);

  if (e.editing) {
    return (
      <tr className="bg-surface">
        <td colSpan={6} className="px-4 py-3">
          <div className="max-w-xl">
            <EditFields e={e} />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="bg-surface">
      <td className="px-4 py-3 font-medium text-fg">
        <div className="flex items-center gap-1.5">
          {task.taskLabel}
          <EditPencilButton onClick={e.startEdit} />
        </div>
        {task.note && <div className="text-xs font-normal text-fg-muted">{task.note}</div>}
      </td>
      <td className="px-4 py-3 text-fg-muted">{DEPARTMENT_LABELS[task.department]}</td>
      <td className="px-4 py-3 text-fg-muted">{RECURRENCE_LABELS[task.recurrence]}</td>
      <td className="px-4 py-3 text-fg-muted">{formatDate(task.plannedDate)}</td>
      <td className="px-4 py-3 text-fg-muted">{task.lastCompletedAt ? formatDate(task.lastCompletedAt) : "—"}</td>
      <td className="px-4 py-3 text-right">
        <RetireCommonTaskButton taskId={task.id} taskLabel={task.taskLabel} />
      </td>
    </tr>
  );
}
