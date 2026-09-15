"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";
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
// ProcurementTracker's — small enough, and self-contained, to duplicate rather than share.
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

export interface GlassStageData {
  id: string;
  label: string;
  dateField: string;
  noteField: string;
  actualDate: string | null;
  note: string | null;
  /** Plain freeform date, filled in by hand — there's no computed forecast for these to sit on
   *  top of (see GlassPurchaseOrder in schema.prisma), unlike the procurement tracker's Planned
   *  column. Null (and un-editable) for the Action plan row, which stays system-computed off
   *  qc_checked_at, and for custom rows, fixed at creation — same as the procurement tracker. */
  plannedDate: string | null;
  plannedDateField: string | null;
  /** Past its own planned date with no actual date recorded yet — same "expected vs actual"
   *  overrun check the procurement tracker's own stages use (see isProcurementStageOverrun),
   *  even though this Planned column is a plain manual field rather than a computed forecast:
   *  a date someone wrote down and then passed is still worth flagging as overdue. False (never
   *  overdue) for the Action plan row and custom action-item rows before they're checked below —
   *  see the map() calls that build these in page.tsx. */
  overrun: boolean;
  /** Which department owns this row — shown as a tag, same label set the step cards use. */
  department: Department;
  /** Purchase owns every other row in this lifecycle and needs visibility on Payment too —
   *  mirrors PhaseStep's owningDepartment + secondaryDepartment (see 1A). Only set on Payment. */
  secondaryDepartment?: Department | null;
  /** Design Engineer (2A's owner) can edit this row even without full Purchase access. */
  requirementGated: boolean;
  /** Accounts can edit this row even without full Purchase access. */
  paymentGated: boolean;
  /** True for the fixed "qc" row, or any custom row opted into Pass/Fail at creation (see
   *  AddActionItemRow) — gets the Pass/Fail button pair instead of a single Mark complete.
   *  Omitted (falsy) on every other fixed stage, which never sets it at all. */
  isPassFail?: boolean;
  /** Meaningful whenever isPassFail is true: null = no result yet, true = passed, false = failed.
   *  Stays null forever on a plain (non-pass/fail) row. */
  qcPassed: boolean | null;
}

interface GlassActionItemData {
  id: string;
  taskLabel: string;
  /** Chosen by whoever added the row — see the department select in AddActionItemRow. */
  department: Department;
  /** Chosen by whoever added the row — see the Pass/Fail checkbox in AddActionItemRow. */
  isPassFail: boolean;
  qcPassed: boolean | null;
  plannedDate: string;
  actualDate: string | null;
  note: string | null;
  overrun: boolean;
}

function StageRow({
  endpoint,
  stage,
  editable,
  previousStageDone,
  onSaved,
}: {
  endpoint: string;
  stage: GlassStageData;
  editable: boolean;
  /** False when the fixed stage immediately above this one in the table isn't done yet — blocks
   *  completing this one out of order. Always true for the first stage and for every custom
   *  action-item row, which aren't part of the sequential chain. */
  previousStageDone: boolean;
  onSaved: () => void;
}) {
  const isDone = stage.actualDate !== null;
  const [dateDraft, setDateDraft] = useSyncedDraft(stage.actualDate, toDateInputValue);
  const [noteDraft, setNoteDraft] = useSyncedDraft(stage.note, (v) => v ?? "");
  const [saving, setSaving] = useState<"date" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plannedDraft, setPlannedDraft] = useSyncedDraft(stage.plannedDate, toDateInputValue);
  const [savingPlanned, setSavingPlanned] = useState(false);
  const [plannedError, setPlannedError] = useState<string | null>(null);

  // Editing an already-done row's date to a *different*, non-empty value is a correction, not a
  // live edit — brings back the completion button and always needs a reason, same rule as the
  // procurement tracker's stages.
  const isCorrection = isDone && dateDraft !== "" && dateDraft !== toDateInputValue(stage.actualDate);
  const showsCompletionAction = !isDone || isCorrection;
  const isActionPlan = stage.id === "actionPlan";
  // What actually gets saved as the actual date if a completion is submitted right now — the
  // chosen date, or today if none was picked (see handleMarkComplete/handleQCOutcome). Comparing
  // against that, rather than just today's date, is what lets a deliberately-backdated late
  // entry still require a reason even though the field wasn't left empty. Planned here is still
  // a plain manual field, not a computed forecast — but a date someone already wrote down and
  // then completes past is late all the same, same "expected vs actual" idea the procurement
  // tracker's own isLate applies to its (computed) Planned column.
  const effectiveActualDate = dateDraft || toDateInputValue(new Date().toISOString());
  const plannedDateValue = toDateInputValue(stage.plannedDate);
  const isLate = plannedDateValue !== "" && effectiveActualDate > plannedDateValue;
  // Row-level highlight, deliberately based on the saved actual date rather than isLate's live
  // draft — so the whole row doesn't flash rose mid-edit before anything's submitted.
  const isSavedLate = stage.actualDate !== null && stage.plannedDate !== null && stage.actualDate > stage.plannedDate;
  const needsReason = (isCorrection || isLate || isActionPlan) && !noteDraft.trim();
  // The fixed qc stage, or a custom row opted into the same Pass/Fail treatment at creation.
  const isQC = stage.id === "qc" || !!stage.isPassFail;
  // A QC failure always needs a note explaining it, whether or not it's a correction.
  const failNeedsNote = isQC && !noteDraft.trim();
  // Only gates a fresh completion, not a correction to an already-done row — fixing a settled
  // date shouldn't be blocked by some unrelated earlier stage's own state.
  const blockedByPreviousStage = !isDone && !previousStageDone;

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

  // Saves immediately on change, same as the procurement tracker's Planned column — no separate
  // confirm step, and every later row re-reads this from the server the moment the page
  // refreshes. Clearing it back to empty removes the value the same way clearing Actual does.
  async function handlePlannedChange(value: string) {
    setPlannedDraft(value);
    if (!stage.plannedDateField) return;
    setSavingPlanned(true);
    setPlannedError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [stage.plannedDateField]: value ? new Date(value).toISOString() : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannedError(typeof data.error === "string" ? data.error : "Could not update the planned date");
        setSavingPlanned(false);
        return;
      }
      onSaved();
      setSavingPlanned(false);
    } catch {
      setPlannedError("Could not reach the server");
      setSavingPlanned(false);
    }
  }

  function handleMarkComplete() {
    const value = dateDraft || toDateInputValue(new Date().toISOString());
    setDateDraft(value);
    patch({ [stage.dateField]: new Date(value).toISOString(), [stage.noteField]: noteDraft.trim() || null }, "date");
  }

  // QC's two outcomes stamp the date and record pass/fail in the same request — there's no
  // separate "Mark complete" step for this row.
  function handleQCOutcome(passed: boolean) {
    const value = dateDraft || toDateInputValue(new Date().toISOString());
    setDateDraft(value);
    patch(
      { [stage.dateField]: new Date(value).toISOString(), qcPassed: passed, [stage.noteField]: noteDraft.trim() || null },
      "date"
    );
  }

  function handleDateInputChange(value: string) {
    setDateDraft(value);
    if (isDone && !value) {
      patch({ [stage.dateField]: null }, "date");
    }
  }

  function handleNoteBlur() {
    if (noteDraft !== (stage.note ?? "")) {
      patch({ [stage.noteField]: noteDraft || null }, "note");
    }
  }

  return (
    <tr className={`border-t border-edge ${isSavedLate ? "bg-rose-500/10 dark:bg-rose-500/[0.08]" : ""}`}>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
              isDone && !isCorrection
                ? stage.qcPassed === false
                  ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
                  : "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400"
                : isCorrection || stage.overrun
                  ? "bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-400"
                  : "bg-overlay text-fg-subtle"
            }`}
          >
            {isDone && !isCorrection ? (
              stage.qcPassed === false ? (
                <XIcon className="h-3.5 w-3.5 stroke-current" />
              ) : (
                <CheckIcon className="h-3.5 w-3.5 stroke-current" />
              )
            ) : (
              <ClockIcon className="h-3.5 w-3.5 stroke-current" />
            )}
          </span>
          <span className="text-sm font-medium text-fg">{stage.label}</span>
          <span className="shrink-0 rounded-full bg-overlay px-1.5 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-edge">
            {DEPARTMENT_LABELS[stage.department]}
            {stage.secondaryDepartment ? ` + ${DEPARTMENT_LABELS[stage.secondaryDepartment]}` : ""}
          </span>
        </div>
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={plannedDraft}
            disabled={!editable || !stage.plannedDateField || savingPlanned}
            onChange={(e) => handlePlannedChange(e.target.value)}
            onClick={openPicker}
            title={stage.plannedDateField ? "Filled in by hand — nothing computes this" : "Planned — not editable"}
            className={`h-9 w-[9.5rem] rounded-lg border px-2 text-sm outline-none disabled:opacity-80 ${
              editable && stage.plannedDateField
                ? "border-edge bg-bg text-fg focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
                : "border-edge bg-overlay text-fg-muted"
            }`}
          />
          {!isDone && stage.overrun && (
            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              Overdue
            </span>
          )}
        </div>
        {plannedError && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{plannedError}</p>}
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
          <span className="text-sm text-fg-muted">{formatDate(stage.actualDate)}</span>
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
                    : needsReason
                      ? "Reason required — this date is after planned"
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
          <span className="text-sm text-fg-muted">{stage.note || "—"}</span>
        )}
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        {editable && showsCompletionAction && isQC && (
          <div className="flex flex-col gap-1">
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => handleQCOutcome(true)}
                disabled={saving === "date" || needsReason || blockedByPreviousStage}
                title={
                  blockedByPreviousStage
                    ? "Complete the previous stage first"
                    : needsReason
                      ? "Add a reason before submitting"
                      : undefined
                }
                className="flex h-9 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving === "date" ? <Spinner className="h-3.5 w-3.5" /> : "Pass"}
              </button>
              <button
                type="button"
                onClick={() => handleQCOutcome(false)}
                disabled={saving === "date" || failNeedsNote || blockedByPreviousStage}
                title={
                  blockedByPreviousStage
                    ? "Complete the previous stage first"
                    : failNeedsNote
                      ? "Add a note explaining the failure first"
                      : undefined
                }
                className="flex h-9 items-center justify-center rounded-lg border border-red-300 px-3 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                Fail
              </button>
            </div>
            {blockedByPreviousStage ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">Complete the previous stage first</span>
            ) : (
              (needsReason || failNeedsNote) && (
                <span className="text-[11px] text-amber-600 dark:text-amber-400">
                  {failNeedsNote && !needsReason ? "Note required to fail" : "Add a reason first"}
                </span>
              )
            )}
          </div>
        )}
        {editable && showsCompletionAction && !isQC && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={handleMarkComplete}
              disabled={saving === "date" || needsReason || blockedByPreviousStage}
              title={
                blockedByPreviousStage
                  ? "Complete the previous stage first"
                  : needsReason
                    ? "Add a reason before submitting"
                    : undefined
              }
              className="flex h-9 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving === "date" ? <Spinner className="h-3.5 w-3.5" /> : "Mark complete"}
            </button>
            {blockedByPreviousStage ? (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">Complete the previous stage first</span>
            ) : (
              needsReason && <span className="text-[11px] text-amber-600 dark:text-amber-400">Add a reason first</span>
            )}
          </div>
        )}
        {isDone && !isCorrection && stage.qcPassed === false && (
          <span className="flex items-center gap-1 text-xs font-medium text-red-600 dark:text-red-400">
            <XIcon className="h-3.5 w-3.5 stroke-current" /> Failed
          </span>
        )}
        {isDone && !isCorrection && stage.qcPassed !== false && (
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

/** The "+ Add row" CTA after the action plan row, and the inline task/planned-date form it opens
 *  into. Only ever rendered once the glass PO both failed QC and has its action plan marked (see
 *  canAddActionItem) — mirrors ProcurementTracker's AddActionItemRow exactly. */
function AddActionItemRow({ glassPurchaseOrderId, onSaved }: { glassPurchaseOrderId: string; onSaved: () => void }) {
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
      const res = await fetch(`/api/glass-purchase-orders/${glassPurchaseOrderId}/action-items`, {
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
        {/* Sits in the "Actual" column — nothing meaningful goes there until this row
            actually exists, so it's the natural spot for the one other thing this form
            needs to collect. */}
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

/**
 * The 3A ("Glass PO") tracker table — Requirement created / Quote created / Payment done /
 * Order confirmed / Actual arrival / QC checked, each an actual date + note filled in by hand,
 * plus a plain manual Planned date column (no computed forecast — see GlassPurchaseOrder in
 * schema.prisma). Sits alongside 3A's own TaskCard rather than replacing it. Once QC fails, an
 * Action plan row and a "+ Add row" CTA for custom follow-up tasks appear, mirroring the
 * procurement tracker's own QC-failure flow exactly.
 */
export function GlassTracker({
  id,
  stages,
  canEdit,
  canEditRequirement,
  canEditPayment,
  canAddActionItem,
  actionItems,
}: {
  id: string;
  stages: GlassStageData[];
  canEdit: boolean;
  /** Design Engineer (2A's owner) can edit the "Requirement created" row even without full Purchase access. */
  canEditRequirement: boolean;
  /** Accounts can edit the "Payment done" row even without full Purchase access. */
  canEditPayment: boolean;
  /** Whether the "+ Add row" CTA should show at all — mirrors the /action-items route's own
   *  server-side check (failed QC + a recorded action plan), so the button never appears only to
   *  fail on click. */
  canAddActionItem: boolean;
  actionItems: GlassActionItemData[];
}) {
  const router = useRouter();

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-fg">Glass PO</h2>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
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
                {stages.map((stage, index) => (
                  <StageRow
                    key={stage.id}
                    endpoint={`/api/glass-purchase-orders/${id}`}
                    stage={stage}
                    editable={
                      stage.requirementGated
                        ? canEdit || canEditRequirement
                        : stage.paymentGated
                          ? canEdit || canEditPayment
                          : canEdit
                    }
                    previousStageDone={index === 0 || stages[index - 1].actualDate !== null}
                    onSaved={() => router.refresh()}
                  />
                ))}
                {actionItems.map((actionItem) => (
                  <StageRow
                    key={actionItem.id}
                    endpoint={`/api/glass-action-items/${actionItem.id}`}
                    stage={{
                      id: actionItem.id,
                      label: actionItem.taskLabel,
                      dateField: "actualDate",
                      noteField: "note",
                      plannedDate: actionItem.plannedDate,
                      plannedDateField: null,
                      actualDate: actionItem.actualDate,
                      note: actionItem.note,
                      department: actionItem.department,
                      isPassFail: actionItem.isPassFail,
                      requirementGated: false,
                      paymentGated: false,
                      qcPassed: actionItem.qcPassed,
                      overrun: actionItem.overrun,
                    }}
                    editable={canEdit}
                    // Custom follow-up rows are a flat todo list, not part of the fixed
                    // sequential chain — never blocked by one another.
                    previousStageDone
                    onSaved={() => router.refresh()}
                  />
                ))}
                {canEdit && canAddActionItem && (
                  <AddActionItemRow glassPurchaseOrderId={id} onSaved={() => router.refresh()} />
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
