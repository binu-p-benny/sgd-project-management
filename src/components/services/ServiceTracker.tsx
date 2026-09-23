"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";
import { Spinner } from "@/components/ui/Spinner";
import { isDueToday } from "@/lib/overrun";
import { DEPARTMENT_LABELS, ASSIGNABLE_DEPARTMENTS } from "@/lib/labels";
import type { Department } from "@prisma/client";

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className={className}>
      <path d="M5 12.5 10 17l9-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className={className}>
      <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" strokeLinecap="round" />
    </svg>
  );
}

export interface ServiceItemData {
  id: string;
  taskLabel: string;
  department: Department;
  isPassFail: boolean;
  qcPassed: boolean | null;
  plannedDate: string;
  actualDate: string | null;
  note: string | null;
  overrun: boolean;
  /** Set once the operation manager has reviewed this item's completion (see task-reviews.ts) —
   *  always false while actualDate is still null. */
  reviewed: boolean;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso)
  );
}

// Some browsers only open the native calendar when the small icon is clicked, not the rest of
// the field — showPicker() makes the whole input open it on any click.
function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const input = e.currentTarget;
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch {
      // no-op: unsupported in this browser, or not triggered by a direct user gesture
    }
  }
}

/** One row of service work — mirrors StageRow in ProcurementTracker.tsx for its custom
 *  ("+ Add row") rows, minus the fixed-stage planned-date-override column (a service item's
 *  planned date is set once, at creation, and never edited afterward).
 *
 *  Exported, with the PATCH endpoint passed in rather than hardcoded, because a project's
 *  additional-work blocks (see AdditionalWorks.tsx) are the same kind of flat work row and share
 *  this exactly — same completion, late-reason and Pass/Fail behavior, just a different table.
 *
 *  allowEditingTaskAndPlannedDate opts into a second edit mode, for the task label and planned
 *  date themselves — off by default (a service item's are fixed at creation, see this row's own
 *  comment above) and on only for AdditionalWorks' work-task rows, whose PATCH endpoint
 *  (/api/work-tasks/[id]) accepts those fields; /api/service-items/[id] doesn't, so turning this
 *  on for a service item would silently drop the edit server-side. */
export function ItemRow({
  item,
  editable,
  patchUrl,
  onSaved,
  allowEditingTaskAndPlannedDate = false,
}: {
  item: ServiceItemData;
  editable: boolean;
  patchUrl: string;
  onSaved: () => void;
  allowEditingTaskAndPlannedDate?: boolean;
}) {
  const isDone = item.actualDate !== null;
  const [dateDraft, setDateDraft] = useSyncedDraft(item.actualDate, toDateInputValue);
  const [noteDraft, setNoteDraft] = useSyncedDraft(item.note, (v) => v ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Its own edit mode, independent of the completion fields above — touching the task's own
  // metadata (what it's called, when it's due) is a different action from recording progress
  // against it, so the two never share draft/submitting state.
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaTaskLabel, setMetaTaskLabel] = useSyncedDraft(item.taskLabel, (v) => v);
  const [metaPlannedDate, setMetaPlannedDate] = useSyncedDraft(item.plannedDate, toDateInputValue);
  const [metaSaving, setMetaSaving] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  // Editing an already-done row's date to a *different*, non-empty value is a correction, not a
  // live edit — same convention as ProcurementTracker's StageRow.
  const isCorrection = isDone && dateDraft !== "" && dateDraft !== toDateInputValue(item.actualDate);
  const showsCompletionAction = !isDone || isCorrection;

  const effectiveActualDate = dateDraft || toDateInputValue(new Date().toISOString());
  const plannedDateValue = toDateInputValue(item.plannedDate);
  const isLate = plannedDateValue !== "" && effectiveActualDate > plannedDateValue;
  const isSavedLate = item.actualDate !== null && item.actualDate > item.plannedDate;
  const needsReason = (isCorrection || isLate) && !noteDraft.trim();
  const isQC = item.isPassFail;
  const failNeedsNote = isQC && !noteDraft.trim();
  // item.overrun is already calendar-day-aware (see overrun.ts) — false for an item due today,
  // so this only ever fires for the one day it's neither overdue nor "not due yet".
  const isDueTodayItem = !isDone && !item.overrun && isDueToday(item.plannedDate);

  async function patch(body: Record<string, unknown>) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Update failed");
        setSaving(false);
        return;
      }
      onSaved();
      setSaving(false);
    } catch {
      setError("Could not reach the server");
      setSaving(false);
    }
  }

  function startEditMeta() {
    setMetaTaskLabel(item.taskLabel);
    setMetaPlannedDate(toDateInputValue(item.plannedDate));
    setMetaError(null);
    setEditingMeta(true);
  }

  function cancelEditMeta() {
    setEditingMeta(false);
    setMetaError(null);
  }

  async function saveMeta() {
    if (!metaTaskLabel.trim() || !metaPlannedDate) {
      setMetaError("Task and planned date are both required");
      return;
    }
    setMetaSaving(true);
    setMetaError(null);
    try {
      const res = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskLabel: metaTaskLabel.trim(),
          plannedDate: new Date(metaPlannedDate).toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMetaError(typeof data.error === "string" ? data.error : "Could not save changes");
        setMetaSaving(false);
        return;
      }
      setMetaSaving(false);
      setEditingMeta(false);
      onSaved();
    } catch {
      setMetaError("Could not reach the server");
      setMetaSaving(false);
    }
  }

  function handleMarkComplete() {
    const value = dateDraft || toDateInputValue(new Date().toISOString());
    setDateDraft(value);
    patch({ actualDate: new Date(value).toISOString(), note: noteDraft.trim() || null });
  }

  function handleQCOutcome(passed: boolean) {
    const value = dateDraft || toDateInputValue(new Date().toISOString());
    setDateDraft(value);
    patch({ actualDate: new Date(value).toISOString(), qcPassed: passed, note: noteDraft.trim() || null });
  }

  function handleDateInputChange(value: string) {
    setDateDraft(value);
    if (isDone && !value) {
      patch({ actualDate: null });
    }
  }

  function handleNoteBlur() {
    if (noteDraft !== (item.note ?? "")) {
      patch({ note: noteDraft || null });
    }
  }

  return (
    <tr className={`border-t border-edge ${isSavedLate ? "bg-rose-500/10 dark:bg-rose-500/[0.08]" : ""}`}>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              isDone && !isCorrection
                ? item.qcPassed === false
                  ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                : isCorrection || item.overrun
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  : isDueTodayItem
                    ? "bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-400"
                    : "bg-overlay text-fg-subtle"
            }`}
          >
            {isDone && !isCorrection ? (
              item.qcPassed === false ? (
                <XIcon className="h-3.5 w-3.5 stroke-current" />
              ) : (
                <CheckIcon className="h-3.5 w-3.5 stroke-current" />
              )
            ) : (
              <ClockIcon className="h-3.5 w-3.5 stroke-current" />
            )}
          </span>
          {allowEditingTaskAndPlannedDate && editable && editingMeta ? (
            <input
              type="text"
              autoFocus
              value={metaTaskLabel}
              disabled={metaSaving}
              onChange={(e) => setMetaTaskLabel(e.target.value)}
              className="h-8 min-w-[8rem] rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
          ) : (
            <span className="text-sm font-medium text-fg">{item.taskLabel}</span>
          )}
          <span className="shrink-0 rounded-full bg-overlay px-1.5 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-edge">
            {DEPARTMENT_LABELS[item.department]}
          </span>
          {item.reviewed && (
            <span className="shrink-0 rounded-full bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-700 ring-1 ring-inset ring-violet-500/25 dark:text-violet-400">
              Reviewed
            </span>
          )}
          {allowEditingTaskAndPlannedDate && editable && !editingMeta && (
            <button
              type="button"
              onClick={startEditMeta}
              aria-label="Edit task and planned date"
              title="Edit task and planned date"
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-subtle transition-colors hover:bg-overlay hover:text-fg"
            >
              <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-3.5 w-3.5 stroke-current">
                <path d="M16.5 4.5 19.5 7.5 8 19H5v-3L16.5 4.5Z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
          {allowEditingTaskAndPlannedDate && editable && editingMeta && (
            <span className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={cancelEditMeta}
                disabled={metaSaving}
                className="rounded-lg border border-edge px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:bg-overlay disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveMeta}
                disabled={metaSaving}
                className="rounded-lg bg-accent px-2 py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {metaSaving ? <Spinner className="h-3 w-3" /> : "Save"}
              </button>
            </span>
          )}
        </div>
        {metaError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{metaError}</p>}
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          {allowEditingTaskAndPlannedDate && editable && editingMeta ? (
            <input
              type="date"
              value={metaPlannedDate}
              disabled={metaSaving}
              onChange={(e) => setMetaPlannedDate(e.target.value)}
              onClick={openPicker}
              className="h-8 w-[8.5rem] rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
          ) : (
            <span className="text-sm text-fg-muted">{formatDate(item.plannedDate)}</span>
          )}
          {!isDone && item.overrun && (
            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              Overdue
            </span>
          )}
          {isDueTodayItem && (
            <span className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-700 ring-1 ring-inset ring-sky-500/25 dark:text-sky-400">
              Due today
            </span>
          )}
        </div>
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        {editable ? (
          <input
            type="date"
            value={dateDraft}
            disabled={saving}
            onChange={(e) => handleDateInputChange(e.target.value)}
            onClick={openPicker}
            className="h-9 w-[9.5rem] rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
        ) : (
          <span className="text-sm text-fg-muted">{formatDate(item.actualDate)}</span>
        )}
      </td>

      <td className="px-3 py-2.5">
        {editable ? (
          <input
            type="text"
            placeholder={
              isCorrection
                ? "Reason required — explain this correction"
                : isQC && !isDone
                  ? "Note (required if it fails)"
                  : needsReason
                    ? "Reason required — this date is after planned"
                    : "Reason (if delayed) or note"
            }
            value={noteDraft}
            disabled={saving}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={handleNoteBlur}
            className={`h-9 w-full min-w-[10rem] rounded-lg border bg-bg px-2.5 text-sm text-fg outline-none focus:ring-2 disabled:opacity-50 ${
              needsReason
                ? "border-amber-400 focus:border-amber-500 focus:ring-amber-400/30"
                : "border-edge focus:border-accent focus:ring-accent/30"
            }`}
          />
        ) : (
          <span className="text-sm text-fg-muted">{item.note || "—"}</span>
        )}
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        {editable && showsCompletionAction && isQC && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => handleQCOutcome(true)}
                disabled={saving || needsReason}
                title={needsReason ? "Add a reason before submitting" : undefined}
                className="flex h-9 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving ? <Spinner className="h-3.5 w-3.5" /> : "Pass"}
              </button>
              <button
                type="button"
                onClick={() => handleQCOutcome(false)}
                disabled={saving || failNeedsNote}
                title={failNeedsNote ? "Add a note explaining the failure first" : undefined}
                className="flex h-9 items-center justify-center rounded-lg border border-red-300 px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                Fail
              </button>
            </div>
            {(needsReason || failNeedsNote) && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">
                {failNeedsNote && !needsReason ? "Note required to fail" : "Add a reason first"}
              </span>
            )}
          </div>
        )}
        {editable && showsCompletionAction && !isQC && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={saving || needsReason}
              title={needsReason ? "Add a reason before submitting" : undefined}
              className="flex h-9 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? <Spinner className="h-3.5 w-3.5" /> : "Mark complete"}
            </button>
            {needsReason && <span className="text-[11px] text-amber-600 dark:text-amber-400">Add a reason first</span>}
          </div>
        )}
        {isDone && !isCorrection && item.qcPassed === false && (
          <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
            <XIcon className="h-3.5 w-3.5 stroke-current" /> Failed
          </span>
        )}
        {isDone && !isCorrection && item.qcPassed !== false && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <CheckIcon className="h-3.5 w-3.5 stroke-current" /> {isQC ? "Passed" : "Done"}
          </span>
        )}
        {!editable && !isDone && <span className="text-xs text-fg-subtle">—</span>}
      </td>

      {error && (
        <td colSpan={5} className="px-3 pb-2">
          <div className="rounded-lg bg-red-500/10 px-2.5 py-1.5 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
            {error}
          </div>
        </td>
      )}
    </tr>
  );
}

/** The "+ Add row" CTA and the inline task/planned-date form it opens into — always available
 *  to anyone who can edit the service (there's no precondition the way ProcurementActionItem's
 *  own add-row has: a service simply starts empty and grows one row at a time).
 *
 *  Exported with the POST endpoint passed in, same reason as ItemRow above. */
export function AddItemRow({ addUrl, onSaved }: { addUrl: string; onSaved: () => void }) {
  const [adding, setAdding] = useState(false);
  const [taskDraft, setTaskDraft] = useState("");
  const [departmentDraft, setDepartmentDraft] = useState("");
  const [passFailDraft, setPassFailDraft] = useState(false);
  const [plannedDraft, setPlannedDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAdd() {
    setAdding(true);
    setTaskDraft("");
    setDepartmentDraft("");
    setPassFailDraft(false);
    setPlannedDraft("");
    setError(null);
  }

  async function handleAdd() {
    if (!taskDraft.trim() || !departmentDraft || !plannedDraft) {
      setError("Task, department and planned date are all required");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(addUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskLabel: taskDraft.trim(),
          department: departmentDraft,
          isPassFail: passFailDraft,
          plannedDate: new Date(plannedDraft).toISOString(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Could not add this row");
        setSubmitting(false);
        return;
      }
      setAdding(false);
      setSubmitting(false);
      onSaved();
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  if (!adding) {
    return (
      <tr className="border-t border-edge">
        <td colSpan={5} className="px-3 py-2.5">
          <button type="button" onClick={openAdd} className="text-xs font-medium text-accent hover:underline">
            + Add row
          </button>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-t border-edge">
      <td className="px-3 py-2.5">
        <div className="flex flex-col gap-1.5">
          <input
            type="text"
            placeholder="Task"
            value={taskDraft}
            disabled={submitting}
            onChange={(e) => setTaskDraft(e.target.value)}
            className="h-9 w-full min-w-[8rem] rounded-lg border border-edge bg-bg px-2.5 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
          <label className="flex items-center gap-1.5 text-xs text-fg-muted">
            <input
              type="checkbox"
              checked={passFailDraft}
              disabled={submitting}
              onChange={(e) => setPassFailDraft(e.target.checked)}
              className="size-3.5 accent-accent disabled:opacity-50"
            />
            Needs pass/fail
          </label>
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <input
          type="date"
          value={plannedDraft}
          disabled={submitting}
          onChange={(e) => setPlannedDraft(e.target.value)}
          onClick={openPicker}
          className="h-9 w-[9.5rem] rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {/* Sits in the "Actual" column — nothing meaningful goes there until this row actually
            exists, so it's the natural spot for the one other thing this form needs to collect. */}
        <select
          value={departmentDraft}
          disabled={submitting}
          onChange={(e) => setDepartmentDraft(e.target.value)}
          className="h-9 w-[9.5rem] rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
        >
          <option value="">Department…</option>
          {ASSIGNABLE_DEPARTMENTS.map((dept) => (
            <option key={dept} value={dept}>
              {DEPARTMENT_LABELS[dept]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2.5">
        {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => setAdding(false)}
            disabled={submitting}
            className="flex h-9 items-center justify-center rounded-lg border border-edge px-3 text-xs font-medium text-fg-muted transition-colors hover:bg-overlay disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={submitting}
            className="flex h-9 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Add"}
          </button>
        </div>
      </td>
    </tr>
  );
}

export function ServiceTracker({
  serviceId,
  items,
  canEdit,
}: {
  serviceId: string;
  items: ServiceItemData[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const doneCount = items.filter((i) => i.actualDate !== null).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-fg">Work items</h2>
        {items.length > 0 && (
          <span className="text-xs font-medium text-fg-subtle">
            {doneCount} / {items.length} done
          </span>
        )}
      </div>

      {/* Violet matches the header card above — this detail page's own identity color,
          distinct from the services list page's teal and from Projects' indigo. */}
      <div className="overflow-x-auto rounded-xl border border-violet-500/30 bg-violet-500/5 dark:border-violet-500/25 dark:bg-violet-500/[0.04]">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-violet-500/10 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle dark:bg-violet-500/[0.08]">
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Task</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Planned</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Actual</th>
              <th className="px-3 py-2 font-semibold">Reason / note</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && !canEdit && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-fg-subtle">
                  No work items yet.
                </td>
              </tr>
            )}
            {items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                editable={canEdit}
                patchUrl={`/api/service-items/${item.id}`}
                onSaved={() => router.refresh()}
              />
            ))}
            {canEdit && <AddItemRow addUrl={`/api/services/${serviceId}/items`} onSaved={() => router.refresh()} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}
