"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";
import { Spinner } from "@/components/ui/Spinner";
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

// Some browsers only open the native calendar when the small icon is clicked, not the rest of
// the field — showPicker() makes the whole input open it on any click. Same helper as
// ProcurementTracker's/GlassTracker's — small enough, and self-contained, to duplicate rather
// than share.
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

export interface SiteQCActionItemData {
  id: string;
  taskLabel: string;
  department: Department;
  isPassFail: boolean;
  qcPassed: boolean | null;
  plannedDate: string;
  actualDate: string | null;
  note: string | null;
}

interface RowData {
  id: string;
  label: string;
  dateField: string;
  noteField: string;
  plannedDate: string | null;
  actualDate: string | null;
  note: string | null;
  department: Department;
  isPassFail?: boolean;
  qcPassed: boolean | null;
}

/** One row — the fixed Action plan row, or a custom follow-up — mirrors GlassTracker's own
 *  StageRow exactly (no lateness concept, just a correction requiring a reason, same as Glass
 *  PO's own stages). Kept local rather than shared for the same reason every tracker in this
 *  app duplicates this row rather than importing one another's. */
function Row({
  endpoint,
  row,
  editable,
  onSaved,
}: {
  endpoint: string;
  row: RowData;
  editable: boolean;
  onSaved: () => void;
}) {
  const isDone = row.actualDate !== null;
  const [dateDraft, setDateDraft] = useSyncedDraft(row.actualDate, toDateInputValue);
  const [noteDraft, setNoteDraft] = useSyncedDraft(row.note, (v) => v ?? "");
  const [saving, setSaving] = useState<"date" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isCorrection = isDone && dateDraft !== "" && dateDraft !== toDateInputValue(row.actualDate);
  const showsCompletionAction = !isDone || isCorrection;
  const isActionPlan = row.id === "actionPlan";
  const needsReason = (isCorrection || isActionPlan) && !noteDraft.trim();
  const isQC = !!row.isPassFail;
  const failNeedsNote = isQC && !noteDraft.trim();

  async function patch(body: Record<string, unknown>, field: "date" | "note") {
    setSaving(field);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Update failed");
        setSaving(null);
        return;
      }
      onSaved();
      setSaving(null);
    } catch {
      setError("Could not reach the server");
      setSaving(null);
    }
  }

  function handleMarkComplete() {
    const value = dateDraft || toDateInputValue(new Date().toISOString());
    setDateDraft(value);
    patch({ [row.dateField]: new Date(value).toISOString(), [row.noteField]: noteDraft.trim() || null }, "date");
  }

  function handleQCOutcome(passed: boolean) {
    const value = dateDraft || toDateInputValue(new Date().toISOString());
    setDateDraft(value);
    patch(
      { [row.dateField]: new Date(value).toISOString(), qcPassed: passed, [row.noteField]: noteDraft.trim() || null },
      "date"
    );
  }

  function handleDateInputChange(value: string) {
    setDateDraft(value);
    if (isDone && !value) {
      patch({ [row.dateField]: null }, "date");
    }
  }

  function handleNoteBlur() {
    if (noteDraft !== (row.note ?? "")) {
      patch({ [row.noteField]: noteDraft || null }, "note");
    }
  }

  return (
    <tr className="border-t border-edge">
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              isDone && !isCorrection
                ? row.qcPassed === false
                  ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                : isCorrection
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  : "bg-overlay text-fg-subtle"
            }`}
          >
            {isDone && !isCorrection ? (
              row.qcPassed === false ? (
                <XIcon className="h-3.5 w-3.5 stroke-current" />
              ) : (
                <CheckIcon className="h-3.5 w-3.5 stroke-current" />
              )
            ) : (
              <ClockIcon className="h-3.5 w-3.5 stroke-current" />
            )}
          </span>
          <span className="text-sm font-medium text-fg">{row.label}</span>
          <span className="shrink-0 rounded-full bg-overlay px-1.5 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-edge">
            {DEPARTMENT_LABELS[row.department]}
          </span>
        </div>
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        <input
          type="date"
          value={toDateInputValue(row.plannedDate)}
          disabled
          readOnly
          title={isActionPlan ? "2 days after the QC failure was recorded" : "Planned — not editable"}
          className="h-9 w-[9.5rem] rounded-lg border border-edge bg-overlay px-2 text-sm text-fg-muted outline-none"
        />
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        {editable ? (
          <input
            type="date"
            value={dateDraft}
            disabled={saving === "date"}
            onChange={(e) => handleDateInputChange(e.target.value)}
            onClick={openPicker}
            className="h-9 w-[9.5rem] rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
        ) : (
          <span className="text-sm text-fg-muted">{formatDate(row.actualDate)}</span>
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
                  : isActionPlan
                    ? "Note (required)"
                    : "Note (optional)"
            }
            value={noteDraft}
            disabled={saving === "note"}
            onChange={(e) => setNoteDraft(e.target.value)}
            onBlur={handleNoteBlur}
            className={`h-9 w-full min-w-[10rem] rounded-lg border bg-bg px-2.5 text-sm text-fg outline-none focus:ring-2 disabled:opacity-50 ${
              needsReason
                ? "border-amber-400 focus:border-amber-500 focus:ring-amber-400/30"
                : "border-edge focus:border-accent focus:ring-accent/30"
            }`}
          />
        ) : (
          <span className="text-sm text-fg-muted">{row.note || "—"}</span>
        )}
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        {editable && showsCompletionAction && isQC && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => handleQCOutcome(true)}
                disabled={saving === "date" || needsReason}
                title={needsReason ? "Add a reason before submitting" : undefined}
                className="flex h-9 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving === "date" ? <Spinner className="h-3.5 w-3.5" /> : "Pass"}
              </button>
              <button
                type="button"
                onClick={() => handleQCOutcome(false)}
                disabled={saving === "date" || failNeedsNote}
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
              disabled={saving === "date" || needsReason}
              title={needsReason ? "Add a reason before submitting" : undefined}
              className="flex h-9 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving === "date" ? <Spinner className="h-3.5 w-3.5" /> : "Mark complete"}
            </button>
            {needsReason && <span className="text-[11px] text-amber-600 dark:text-amber-400">Add a reason first</span>}
          </div>
        )}
        {isDone && !isCorrection && row.qcPassed === false && (
          <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
            <XIcon className="h-3.5 w-3.5 stroke-current" /> Failed
          </span>
        )}
        {isDone && !isCorrection && row.qcPassed !== false && (
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

/** The "+ Add row" CTA and the inline task/planned-date form it opens into — mirrors
 *  ProcurementTracker's/GlassTracker's AddActionItemRow exactly, just posting to
 *  /api/phase-steps/[id]/action-items instead. Only ever rendered once 3E has actually failed
 *  QC and its action plan is marked (see SiteQCTracker's own canAddActionItem prop). */
function AddActionItemRow({ phaseStepId, onSaved }: { phaseStepId: string; onSaved: () => void }) {
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
      const res = await fetch(`/api/phase-steps/${phaseStepId}/action-items`, {
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
      <td className="px-3 py-2.5">{error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}</td>
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

/**
 * 3E's ("Final QC on site") action plan and custom follow-up rows — sits alongside 3E's own
 * TaskCard rather than replacing it, same as GlassTracker sits alongside 3A's. Only ever
 * rendered once 3E has actually failed a QC check (see qcPassed on PhaseStep); re-checking QC
 * itself is just clicking Pass/Fail on 3E's TaskCard again, not anything this component owns.
 */
export function SiteQCTracker({
  phaseStepId,
  actionPlanAt,
  actionPlanPlannedDate,
  actionPlanNote,
  canEdit,
  canAddActionItem,
  actionItems,
}: {
  phaseStepId: string;
  actionPlanAt: string | null;
  actionPlanPlannedDate: string | null;
  actionPlanNote: string | null;
  canEdit: boolean;
  /** Whether the "+ Add row" CTA should show at all — mirrors the /action-items route's own
   *  server-side check (failed QC + a recorded action plan), so the button never appears only
   *  to fail on click. */
  canAddActionItem: boolean;
  actionItems: SiteQCActionItemData[];
}) {
  const router = useRouter();

  const actionPlanRow: RowData = {
    id: "actionPlan",
    label: "Action plan",
    dateField: "actionPlanAt",
    noteField: "actionPlanNote",
    plannedDate: actionPlanPlannedDate,
    actualDate: actionPlanAt,
    note: actionPlanNote,
    department: "project_engineer",
    qcPassed: null,
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
      <h2 className="text-lg font-semibold text-fg">Final QC — action plan</h2>
      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-overlay text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Task</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Planned</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Actual</th>
              <th className="px-3 py-2 font-semibold">Reason / note</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            <Row
              endpoint={`/api/phase-steps/${phaseStepId}`}
              row={actionPlanRow}
              editable={canEdit}
              onSaved={() => router.refresh()}
            />
            {actionItems.map((actionItem) => (
              <Row
                key={actionItem.id}
                endpoint={`/api/phase-step-action-items/${actionItem.id}`}
                row={{
                  id: actionItem.id,
                  label: actionItem.taskLabel,
                  dateField: "actualDate",
                  noteField: "note",
                  plannedDate: actionItem.plannedDate,
                  actualDate: actionItem.actualDate,
                  note: actionItem.note,
                  department: actionItem.department,
                  isPassFail: actionItem.isPassFail,
                  qcPassed: actionItem.qcPassed,
                }}
                editable={canEdit}
                onSaved={() => router.refresh()}
              />
            ))}
            {canEdit && canAddActionItem && (
              <AddActionItemRow phaseStepId={phaseStepId} onSaved={() => router.refresh()} />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
