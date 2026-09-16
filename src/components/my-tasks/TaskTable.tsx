"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { UnifiedTask } from "@/lib/unified-tasks";
import { Spinner } from "@/components/ui/Spinner";
import {
  BLOCKED_REASON_LABELS,
  BLOCKED_REASON_OPTIONS,
  DELAY_CATEGORY_LABELS,
  DELAY_CATEGORY_OPTIONS,
  DEPARTMENT_LABELS,
} from "@/lib/labels";

// Mirrors TaskCard.tsx's own copies of these same sets — kept local for the same reason: the
// server-side originals (step-actions.ts) pull in the Prisma client, which this "use client"
// file can't import.
const SINGLE_COMPLETION_STEP_CODES = new Set(["1A", "1B", "1D", "2D2"]);
const DELAY_CATEGORY_STEP_CODES = new Set(["1A", "1B", "1C", "1D", "2D2"]);
const MANUAL_PLANNED_DATE_STEP_CODES = new Set(["3C1", "3C2", "3E"]);
// 3E only — a single on-site QC check has no planned start worth tracking, see
// MANUAL_PLANNED_END_ONLY_STEP_CODES in step-actions.ts (this file's own mirrored copy).
const MANUAL_PLANNED_END_ONLY_STEP_CODES = new Set(["3E"]);
// 3C1 only, for now — see MANUAL_CONTRACTOR_STEP_CODES in step-actions.ts (this file's own
// mirrored copy, same reason every other set here is: that file pulls in the Prisma client).
const MANUAL_CONTRACTOR_STEP_CODES = new Set(["3C1"]);

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}
function toDateInputValue(iso: string | null): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  return iso.slice(0, 10);
}
// Unlike toDateInputValue above (defaults an empty actual date to today, since that's almost
// always what's meant), a blank Planned date should stay blank — defaulting it to today would
// mean silently submitting today's date as a "planned" one if the field's left untouched.
function toPlannedDateInputValue(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}
function daysOverdue(plannedIso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(plannedIso).getTime()) / (1000 * 60 * 60 * 24)));
}
function formatPhase(phase: UnifiedTask["phase"]): string {
  if (phase === "service") return "Service";
  return phase === "phase_1" ? "Phase 1" : phase === "phase_2" ? "Phase 2" : "Phase 3";
}

// Every field a row actually shows, flattened into one lowercased string — this is what the
// general filter below matches against, so "matches anything in the row" is literal rather than
// scoped to just the task name. Computed fresh per render rather than memoized: the task list
// itself is already small (one department's open tasks), so there's nothing here worth caching.
function taskSearchText(task: UnifiedTask): string {
  return [
    task.project.name,
    task.project.client.name,
    task.taskLabel,
    task.subTaskLabel,
    task.stepCode,
    formatPhase(task.phase),
    DEPARTMENT_LABELS[task.department],
    task.secondaryDepartment ? DEPARTMENT_LABELS[task.secondaryDepartment] : null,
    task.blockedReason ? BLOCKED_REASON_LABELS[task.blockedReason] : null,
    task.blockedNote,
    task.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

// The 3 non-phase_step kinds are all structurally identical — one date field + one note field,
// no status/gate/blocking concept — so a single endpoint-builder covers all of them; only
// phase_step needs its own richer status-transition handling below.
function simpleStageEndpoint(task: UnifiedTask): string {
  if (task.kind === "procurement_stage") return `/api/procurement-items/${task.refId}`;
  if (task.kind === "glass_po_stage") return `/api/glass-purchase-orders/${task.refId}`;
  if (task.kind === "service_item") return `/api/service-items/${task.refId}`;
  // action_item
  if (task.actionItemSource === "procurement") return `/api/procurement-action-items/${task.refId}`;
  if (task.actionItemSource === "glass") return `/api/glass-action-items/${task.refId}`;
  return `/api/phase-step-action-items/${task.refId}`;
}

// Two field sizes: "sm" is the desktop table's own compact scale (unchanged from before this
// file grew a mobile view); "md" is the mobile accordion's — taller hit targets and 16px text
// so iOS doesn't zoom the viewport on focus. Every control below picks its classes off `size`
// so the two layouts stay a single source of truth for what a control *is*.
type Size = "sm" | "md";
function fieldCls(size: Size): string {
  const dims = size === "sm" ? "h-8 px-2 text-xs" : "h-11 px-3 text-base";
  return `${dims} w-full min-w-0 rounded-lg border border-edge bg-bg text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30`;
}
function btnCls(kind: "primary" | "danger" | "secondary", size: Size): string {
  const dims = size === "sm" ? "h-8 px-2.5 text-xs" : "h-11 px-4 text-sm";
  const base = `flex ${dims} items-center justify-center rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40`;
  if (kind === "primary") return `${base} bg-accent text-white hover:bg-accent-2`;
  if (kind === "danger")
    return `${base} border border-red-300 text-red-600 hover:bg-red-50 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10`;
  return `${base} border border-edge text-fg-muted hover:border-edge-2 hover:bg-overlay hover:text-fg`;
}
function spinnerCls(size: Size): string {
  return size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4";
}

// Left-border + faint wash that marks a row as belonging to a Project vs a Service — same
// identity colors the rest of the app already uses (indigo = the accent, Projects; teal =
// Services, see services/page.tsx), so a row reads as one or the other at a glance. Shared
// verbatim between the desktop <tr> and the mobile card.
function kindAccentCls(isServiceTask: boolean): string {
  return isServiceTask
    ? "border-l-teal-500/70 bg-teal-500/[0.03] dark:bg-teal-500/[0.05]"
    : "border-l-accent/60 bg-indigo-500/[0.02] dark:bg-indigo-500/[0.04]";
}

type Panel = "none" | "block" | "visitUrgency";
// A completed task no longer matches "open tasks", so router.refresh() below makes its row
// vanish from the array outright — with no delay at all it would just blink out of existence
// mid-click. RowPhase plays a brief success flash, then a fade, before the refresh actually
// removes it, so completing something reads as "done!" rather than "the row glitched away".
type RowPhase = "idle" | "success" | "leaving";
const ROW_SUCCESS_MS = 500;
const ROW_LEAVE_MS = 300;

// Everything a task row *does* — all the mutation state, the derived validation flags, and the
// action handlers — with no markup of its own. Both the desktop table row and the mobile
// accordion card call this, so the two layouts can never drift on what's required before a
// button goes live or which endpoint a completion hits.
function useTaskActions(task: UnifiedTask) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("none");
  const [actualDate, setActualDate] = useState(toDateInputValue(task.actualDate));
  const [note, setNote] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [blockedNote, setBlockedNote] = useState("");
  const [visitUrgency, setVisitUrgency] = useState("");
  const [delayCategory, setDelayCategory] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rowPhase, setRowPhase] = useState<RowPhase>("idle");
  const rowTimeouts = useRef<ReturnType<typeof setTimeout>[]>([]);
  // 3C1's own contractor pick — a separate action from everything else on this row (see
  // saveContractor below), reachable straight from here since it's the owning department's own
  // call, not an admin-only date edit (see POST /api/phase-steps/[id]/contractor).
  const isManualContractorStep = !!task.stepCode && MANUAL_CONTRACTOR_STEP_CODES.has(task.stepCode);
  const needsContractor = isManualContractorStep && !task.contractorId;
  const [contractors, setContractors] = useState<{ id: string; name: string }[]>([]);
  const [contractorDraft, setContractorDraft] = useState("");
  const [contractorSubmitting, setContractorSubmitting] = useState(false);
  const [contractorError, setContractorError] = useState<string | null>(null);
  // kind === "planned_date_edit" only — this department's own delegated pick at filling in a
  // MANUAL_PLANNED_DATE_STEP_CODES step's Planned start/end (see plannedDateEditDepartment,
  // savePlannedDateEdit below). Seeded from whatever's already there (e.g. a start saved earlier
  // with no end yet), same partial-draft idea as PlannedDatesField in TaskCard.tsx.
  const [plannedDateEditStart, setPlannedDateEditStart] = useState(
    toPlannedDateInputValue(task.manualPlannedStartDate)
  );
  const [plannedDateEditEnd, setPlannedDateEditEnd] = useState(toPlannedDateInputValue(task.manualPlannedEndDate));
  const [plannedDateEditSubmitting, setPlannedDateEditSubmitting] = useState(false);
  const [plannedDateEditError, setPlannedDateEditError] = useState<string | null>(null);
  // kind === "review_completed" only — the operation manager's own optional note, saved via
  // POST /api/task-reviews (see saveReview below). task.refId here is the underlying completed
  // task's own composite id (e.g. "phase_step:xxx"), not a row this file can PATCH directly.
  const [reviewNoteDraft, setReviewNoteDraft] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    const timeouts = rowTimeouts.current;
    return () => {
      timeouts.forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (!needsContractor) return;
    let cancelled = false;
    fetch("/api/contractors")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setContractors(Array.isArray(data) ? data : []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [needsContractor]);

  // Shared by patch() below and by saveContractor/savePlannedDateEdit, which hit their own
  // endpoints rather than patch()'s — the same flash-then-fade-then-refresh dance either way, so
  // completing any of these reads as "done!" rather than the row just glitching away. When the
  // row isn't actually leaving (a partial planned-date save, say), it flashes green and settles
  // back to idle instead, then still refreshes so the newly-saved value shows — onSettle resets
  // that action's own submitting flag at the same point, since the row (and its button) is still
  // here afterward and needs to be clickable again; the removesRow branch skips it on purpose
  // (see the comment below) since there's no row left for it to matter on.
  function flashRowSuccess(opts: { removesRow: boolean; onSettle?: () => void }) {
    setRowPhase("success");
    if (opts.removesRow) {
      // Keep the triggering action's own `submitting` flag true throughout — the row's on its
      // way out, nothing on it should be clickable in the meantime — and let the flash-then-fade
      // play out before the refresh below actually drops it from the list.
      rowTimeouts.current.push(
        setTimeout(() => setRowPhase("leaving"), ROW_SUCCESS_MS),
        setTimeout(() => router.refresh(), ROW_SUCCESS_MS + ROW_LEAVE_MS)
      );
    } else {
      rowTimeouts.current.push(
        setTimeout(() => {
          setRowPhase("idle");
          opts.onSettle?.();
          router.refresh();
        }, ROW_SUCCESS_MS)
      );
    }
  }

  async function saveContractor() {
    if (!contractorDraft) {
      setContractorError("Choose a contractor");
      return;
    }
    setContractorSubmitting(true);
    setContractorError(null);
    try {
      const res = await fetch(`/api/phase-steps/${task.refId}/contractor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractorId: contractorDraft }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setContractorError(typeof data.error === "string" ? data.error : "Could not save contractor");
        setContractorSubmitting(false);
        return;
      }
      // Picking a contractor always fully resolves this task — it never sticks around partially
      // filled, unlike the planned dates below — so this always removes the row.
      flashRowSuccess({ removesRow: true });
    } catch {
      setContractorError("Could not reach the server");
      setContractorSubmitting(false);
    }
  }

  async function savePlannedDateEdit() {
    setPlannedDateEditSubmitting(true);
    setPlannedDateEditError(null);
    const endOnly = !!task.stepCode && MANUAL_PLANNED_END_ONLY_STEP_CODES.has(task.stepCode);
    // Whether this save is the one that actually locks the step in (see buildPlannedDateEditTasks
    // in unified-tasks.ts) — a start-only save on 3C1/3C2 still leaves the task open, so that case
    // flashes success without removing the row.
    const willLock = endOnly ? !!plannedDateEditEnd : !!plannedDateEditStart && !!plannedDateEditEnd;
    try {
      const res = await fetch(`/api/phase-steps/${task.refId}/planned-dates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(endOnly ? {} : { plannedStartDate: plannedDateEditStart ? new Date(plannedDateEditStart).toISOString() : null }),
          plannedEndDate: plannedDateEditEnd ? new Date(plannedDateEditEnd).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannedDateEditError(typeof data.error === "string" ? data.error : "Could not save planned dates");
        setPlannedDateEditSubmitting(false);
        return;
      }
      flashRowSuccess({ removesRow: willLock, onSettle: () => setPlannedDateEditSubmitting(false) });
    } catch {
      setPlannedDateEditError("Could not reach the server");
      setPlannedDateEditSubmitting(false);
    }
  }

  async function saveReview() {
    setReviewSubmitting(true);
    setReviewError(null);
    try {
      const res = await fetch("/api/task-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: task.refId, note: reviewNoteDraft.trim() || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setReviewError(typeof data.error === "string" ? data.error : "Could not save review");
        setReviewSubmitting(false);
        return;
      }
      // Reviewing always fully resolves this row — there's no partial-review state to leave it
      // open for, unlike a planned-date save.
      flashRowSuccess({ removesRow: true });
    } catch {
      setReviewError("Could not reach the server");
      setReviewSubmitting(false);
    }
  }

  const isLate = !!task.plannedDate && actualDate > toDateInputValue(task.plannedDate);
  const needsDelayCategory = !!(
    task.kind === "phase_step" &&
    task.stepCode &&
    DELAY_CATEGORY_STEP_CODES.has(task.stepCode) &&
    isLate
  );
  const needsLateReason = isLate && !note.trim();
  // Start/Mark complete stay disabled until both the Planned dates *and* (for 3C1) the
  // contractor are set — same "still can't begin without either" logic as TaskCard.tsx.
  const blockedByUnsavedPlannedDates = !!(
    task.kind === "phase_step" &&
    task.stepCode &&
    MANUAL_PLANNED_DATE_STEP_CODES.has(task.stepCode) &&
    (!task.plannedDate || needsContractor)
  );
  const blockedByUnsavedPlannedDatesReason = needsContractor ? "contractor" : !task.plannedDate ? "dates" : null;
  // Mirrors ProcurementTracker's own needsReason, which requires a note for ANY late
  // completion, not just a QC failure — Glass PO's version (and SiteQCTracker's) deliberately
  // excludes lateness (see GlassTracker.tsx/SiteQCTracker.tsx's own needsReason, "no lateness
  // concept"), so this only ever applies to procurement stages and procurement action items.
  const needsLateReasonSimple =
    isLate &&
    !note.trim() &&
    (task.kind === "procurement_stage" || (task.kind === "action_item" && task.actionItemSource === "procurement"));

  async function patch(
    url: string,
    body: Record<string, unknown>,
    opts: { removesRow?: boolean } = {}
  ): Promise<boolean> {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.detail?.blockedBy ? ` (waiting on: ${data.detail.blockedBy.join(", ")})` : "";
        setError((typeof data.error === "string" ? data.error : "Update failed") + detail);
        setSubmitting(false);
        return false;
      }
      setPanel("none");
      setNote("");
      if (opts.removesRow) {
        // Keep `submitting` true throughout — the row's on its way out, nothing on it should
        // be clickable in the meantime — and let the flash-then-fade play out before the
        // refresh below actually drops it from the list.
        flashRowSuccess({ removesRow: true });
      } else {
        setSubmitting(false);
        router.refresh();
      }
      return true;
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
      return false;
    }
  }

  // --- Simple stage (procurement/glass-PO/action-item) actions ---
  function completeSimple(passed?: boolean) {
    if (passed === false && !note.trim()) {
      setError("A note is required to fail");
      return;
    }
    if (needsLateReasonSimple) {
      setError("This is late — add a note explaining why before submitting");
      return;
    }
    const body: Record<string, unknown> = {
      [task.dateField!]: new Date(actualDate).toISOString(),
      ...(task.noteField ? { [task.noteField]: note || undefined } : {}),
      ...(task.isPassFail ? { qcPassed: passed ?? true } : {}),
    };
    patch(simpleStageEndpoint(task), body, { removesRow: passed !== false });
  }

  // --- Phase step actions ---
  function startStep() {
    patch(`/api/phase-steps/${task.refId}`, {
      status: "in_progress",
      notes: note || undefined,
      actualStartDate: new Date(actualDate).toISOString(),
    });
  }
  function resumeStep() {
    patch(`/api/phase-steps/${task.refId}`, { status: "in_progress", notes: note || undefined });
  }
  function completePhaseStep(extra: Record<string, unknown> = {}) {
    if (task.stepCode === "1A" && !visitUrgency) {
      setPanel("visitUrgency");
      return;
    }
    if (needsLateReason) {
      setError("Actual end is after the planned finish — add a note explaining why first");
      return;
    }
    if (needsDelayCategory && !delayCategory) {
      setError("Choose whether the delay was client side or in house");
      return;
    }
    patch(
      `/api/phase-steps/${task.refId}`,
      {
        status: "completed",
        notes: note || undefined,
        actualEndDate: new Date(actualDate).toISOString(),
        delayCategory: delayCategory || undefined,
        ...extra,
      },
      { removesRow: true }
    );
  }
  function confirmVisitUrgency() {
    if (!visitUrgency) {
      setError("Choose the visit urgency");
      return;
    }
    completePhaseStep({ visitUrgency });
  }
  function handleQCOutcome(passed: boolean) {
    if (passed) {
      completePhaseStep({ qcPassed: true });
      return;
    }
    if (!note.trim()) {
      setError("A note is required when QC fails");
      return;
    }
    patch(`/api/phase-steps/${task.refId}`, { qcPassed: false, notes: note });
  }
  function confirmBlock() {
    if (!blockedReason) {
      setError("Choose a reason");
      return;
    }
    if (blockedReason === "other" && !blockedNote.trim()) {
      setError("A note is required for 'Other'");
      return;
    }
    patch(`/api/phase-steps/${task.refId}`, { status: "blocked", blockedReason, blockedNote: blockedNote || undefined });
  }

  const canStartOrComplete = task.gateBlockedBy === null || task.gateBlockedBy.length === 0;
  const isPhaseStep = task.kind === "phase_step";
  // phase === "service" rather than kind === "service_item": a review_completed row built from a
  // completed service item (see getReviewQueueTasks) still needs to read as a Service here too,
  // not just the original service_item kind it was derived from.
  const isServiceTask = task.phase === "service";
  // 1A collects its delay category *inside* the visit-urgency panel (see confirmVisitUrgency),
  // not before it opens — gating the row's own initial button on it too would disable the very
  // click that's supposed to open that panel in the first place, a deadlock. Every other step
  // that needs one shows the inline dropdown right in this row (see the Reason cell), so gating
  // their own button on it is correct.
  const blockedByMissingDelayCategory = needsDelayCategory && !delayCategory && task.stepCode !== "1A";
  // Mirrors TaskCard.tsx's own `(item.stepCode !== "1A" && (needsLateReason || needsDelayCategory))`
  // — a late completion needs its note before the button goes live, same "not 1A" carve-out as
  // above and for the same reason: 1A's own lateness note is the row's existing Reason field,
  // but the button's first job for 1A is just to open the visit-urgency panel (see
  // completePhaseStep), so gating it on the note too would block that click from ever happening.
  const blockedByMissingLateReason = needsLateReason && task.stepCode !== "1A";

  return {
    panel,
    setPanel,
    actualDate,
    setActualDate,
    note,
    setNote,
    blockedReason,
    setBlockedReason,
    blockedNote,
    setBlockedNote,
    visitUrgency,
    setVisitUrgency,
    delayCategory,
    setDelayCategory,
    submitting,
    error,
    rowPhase,
    isLate,
    needsDelayCategory,
    needsLateReason,
    blockedByUnsavedPlannedDates,
    blockedByUnsavedPlannedDatesReason,
    isManualContractorStep,
    needsContractor,
    contractors,
    contractorDraft,
    setContractorDraft,
    contractorSubmitting,
    contractorError,
    saveContractor,
    plannedDateEditStart,
    setPlannedDateEditStart,
    plannedDateEditEnd,
    setPlannedDateEditEnd,
    plannedDateEditSubmitting,
    plannedDateEditError,
    savePlannedDateEdit,
    reviewNoteDraft,
    setReviewNoteDraft,
    reviewSubmitting,
    reviewError,
    saveReview,
    needsLateReasonSimple,
    canStartOrComplete,
    isPhaseStep,
    isServiceTask,
    blockedByMissingDelayCategory,
    blockedByMissingLateReason,
    completeSimple,
    startStep,
    resumeStep,
    completePhaseStep,
    confirmVisitUrgency,
    handleQCOutcome,
    confirmBlock,
  };
}
type TaskActions = ReturnType<typeof useTaskActions>;

// --- Shared controls: identical in the table and the accordion, sized off `size` ---

function ActualDateField({ s, size, label }: { s: TaskActions; size: Size; label?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs font-medium text-fg-muted">{label}</span>}
      <input
        type="date"
        value={s.actualDate}
        onChange={(e) => s.setActualDate(e.target.value)}
        className={fieldCls(size)}
      />
    </div>
  );
}

function ReasonField({
  task,
  s,
  size,
  label,
}: {
  task: UnifiedTask;
  s: TaskActions;
  size: Size;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-xs font-medium text-fg-muted">{label}</span>}
      <input
        type="text"
        value={s.note}
        onChange={(e) => s.setNote(e.target.value)}
        placeholder={
          (s.isPhaseStep && s.needsLateReason) || s.needsLateReasonSimple
            ? "Required — late"
            : task.isPassFail
              ? "Required to fail"
              : "Note"
        }
        className={fieldCls(size)}
      />
      {/* Only reachable outside the 1A visit-urgency panel — 1A's own late completion asks for
          this from inside that panel instead (see confirmVisitUrgency). */}
      {s.needsDelayCategory && task.stepCode !== "1A" && (
        <select
          className={fieldCls(size)}
          value={s.delayCategory}
          onChange={(e) => s.setDelayCategory(e.target.value)}
        >
          <option value="">Reason for delay…</option>
          {DELAY_CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {DELAY_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      )}
      {(s.blockedByMissingLateReason || s.needsLateReasonSimple) && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">Add a note before marking this late</p>
      )}
    </div>
  );
}

// The action side of a kind === "contractor_selection" row (see that kind in unified-tasks.ts) —
// just the picker + save button. No bordered box or "Target …/overdue" header of its own: unlike
// the old embedded widget this replaces, this task now has its own row, so its due date already
// shows through the row's normal Planned-date column/badge (task.plannedDate/task.overrun, set to
// contractorPlannedDate/contractorOverdue by buildPhaseStepTasks) the same as any other task.
function ContractorActionField({ s, size }: { s: TaskActions; size: Size }) {
  return (
    <div className="flex flex-col gap-1.5">
      <select
        className={fieldCls(size)}
        value={s.contractorDraft}
        onChange={(e) => s.setContractorDraft(e.target.value)}
      >
        <option value="">Select contractor…</option>
        {s.contractors.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={btnCls("primary", size)}
        onClick={s.saveContractor}
        disabled={s.contractorSubmitting}
      >
        {s.contractorSubmitting ? <Spinner className={spinnerCls(size)} /> : "Save contractor"}
      </button>
      {s.contractorError && <p className="text-[11px] text-red-600 dark:text-red-400">{s.contractorError}</p>}
    </div>
  );
}

// The action side of a kind === "planned_date_edit" row (see that kind in unified-tasks.ts) —
// only reachable once an admin has delegated this MANUAL_PLANNED_DATE_STEP_CODES step's own
// Planned start/end to this department (see plannedDateEditDepartment). 3E's row skips the start
// input, same "end-only" carve-out TaskCard.tsx's admin-side PlannedDatesField already applies.
function PlannedDateEditField({ task, s, size }: { task: UnifiedTask; s: TaskActions; size: Size }) {
  const endOnly = !!task.stepCode && MANUAL_PLANNED_END_ONLY_STEP_CODES.has(task.stepCode);
  return (
    <div className="flex flex-col gap-1.5">
      {!endOnly && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-fg-muted">Planned start</span>
          <input
            type="date"
            value={s.plannedDateEditStart}
            onChange={(e) => s.setPlannedDateEditStart(e.target.value)}
            className={fieldCls(size)}
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <span className="text-[11px] font-medium text-fg-muted">Planned end</span>
        <input
          type="date"
          value={s.plannedDateEditEnd}
          onChange={(e) => s.setPlannedDateEditEnd(e.target.value)}
          className={fieldCls(size)}
        />
      </div>
      <button
        type="button"
        className={btnCls("primary", size)}
        onClick={s.savePlannedDateEdit}
        disabled={s.plannedDateEditSubmitting}
      >
        {s.plannedDateEditSubmitting ? <Spinner className={spinnerCls(size)} /> : "Save planned dates"}
      </button>
      {s.plannedDateEditError && <p className="text-[11px] text-red-600 dark:text-red-400">{s.plannedDateEditError}</p>}
    </div>
  );
}

// The action side of a kind === "review_completed" row (see getReviewQueueTasks in
// task-reviews.ts) — an optional note plus one button, same "single action resolves the row"
// shape as ContractorActionField, just with no required input at all.
function ReviewActionField({ s, size }: { s: TaskActions; size: Size }) {
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        rows={2}
        value={s.reviewNoteDraft}
        onChange={(e) => s.setReviewNoteDraft(e.target.value)}
        placeholder="Review note (optional)"
        className={`${fieldCls(size)} h-auto py-1.5`}
      />
      <button
        type="button"
        className={btnCls("primary", size)}
        onClick={s.saveReview}
        disabled={s.reviewSubmitting}
      >
        {s.reviewSubmitting ? <Spinner className={spinnerCls(size)} /> : "Review completed"}
      </button>
      {s.reviewError && <p className="text-[11px] text-red-600 dark:text-red-400">{s.reviewError}</p>}
    </div>
  );
}

function TaskActionCluster({
  task,
  s,
  isAdmin,
  size,
}: {
  task: UnifiedTask;
  s: TaskActions;
  isAdmin: boolean;
  size: Size;
}) {
  const noticeW = size === "sm" ? "max-w-[12rem]" : "";
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {s.isPhaseStep ? (
          <>
            {task.status === "not_started" &&
              (SINGLE_COMPLETION_STEP_CODES.has(task.stepCode!) ? (
                <button
                  className={btnCls("primary", size)}
                  onClick={() => s.completePhaseStep()}
                  disabled={
                    s.submitting ||
                    !s.canStartOrComplete ||
                    s.blockedByUnsavedPlannedDates ||
                    s.blockedByMissingDelayCategory ||
                    s.blockedByMissingLateReason
                  }
                >
                  {s.submitting ? (
                    <Spinner className={spinnerCls(size)} />
                  ) : task.stepCode === "2D2" ? (
                    "Mark complete"
                  ) : (
                    "Completed"
                  )}
                </button>
              ) : (
                <button
                  className={btnCls("primary", size)}
                  onClick={s.startStep}
                  disabled={s.submitting || !s.canStartOrComplete || s.blockedByUnsavedPlannedDates}
                >
                  {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Start"}
                </button>
              ))}
            {task.status === "in_progress" &&
              (task.isPassFail ? (
                <>
                  <button
                    className={btnCls("primary", size)}
                    onClick={() => s.handleQCOutcome(true)}
                    disabled={
                      s.submitting ||
                      !s.canStartOrComplete ||
                      s.blockedByUnsavedPlannedDates ||
                      s.needsLateReason ||
                      s.blockedByMissingDelayCategory
                    }
                  >
                    {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Pass"}
                  </button>
                  <button
                    className={btnCls("danger", size)}
                    onClick={() => s.handleQCOutcome(false)}
                    disabled={s.submitting || s.blockedByUnsavedPlannedDates || !s.note.trim()}
                    title={!s.note.trim() ? "Add a note explaining the failure first" : undefined}
                  >
                    {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Fail"}
                  </button>
                </>
              ) : (
                <button
                  className={btnCls("primary", size)}
                  onClick={() => s.completePhaseStep()}
                  disabled={
                    s.submitting ||
                    !s.canStartOrComplete ||
                    s.blockedByUnsavedPlannedDates ||
                    s.blockedByMissingDelayCategory ||
                    s.blockedByMissingLateReason
                  }
                >
                  {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Mark complete"}
                </button>
              ))}
            {task.status === "blocked" && (
              <button className={btnCls("primary", size)} onClick={s.resumeStep} disabled={s.submitting}>
                {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Resume"}
              </button>
            )}
            {(task.status === "not_started" || task.status === "in_progress") && (
              <button
                className={btnCls("secondary", size)}
                onClick={() => s.setPanel(s.panel === "block" ? "none" : "block")}
                disabled={s.submitting}
              >
                Report blocked
              </button>
            )}
          </>
        ) : task.isPassFail ? (
          <>
            <button
              className={btnCls("primary", size)}
              onClick={() => s.completeSimple(true)}
              disabled={s.submitting || s.needsLateReasonSimple}
              title={s.needsLateReasonSimple ? "Add a note explaining the delay first" : undefined}
            >
              {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Pass"}
            </button>
            <button
              className={btnCls("danger", size)}
              onClick={() => s.completeSimple(false)}
              disabled={s.submitting || !s.note.trim()}
              title={!s.note.trim() ? "Add a note explaining the failure first" : undefined}
            >
              {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Fail"}
            </button>
          </>
        ) : (
          <button
            className={btnCls("primary", size)}
            onClick={() => s.completeSimple()}
            disabled={s.submitting || s.needsLateReasonSimple}
            title={s.needsLateReasonSimple ? "Add a note explaining the delay first" : undefined}
          >
            {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Mark complete"}
          </button>
        )}
      </div>
      {s.isPhaseStep &&
        !s.canStartOrComplete &&
        task.gateBlockedBy &&
        (task.status === "not_started" || task.status === "in_progress") && (
          <div className={`${noticeW} text-[11px] text-fg-subtle`}>Waiting on: {task.gateBlockedBy.join(", ")}</div>
        )}
      {s.isPhaseStep &&
        s.blockedByUnsavedPlannedDates &&
        (task.status === "not_started" || task.status === "in_progress") && (
          <div className={`${noticeW} text-[11px] text-amber-600 dark:text-amber-400`}>
            {s.blockedByUnsavedPlannedDatesReason === "contractor" ? (
              "Select a contractor for this step first"
            ) : (
              <>
                Planned dates not set yet —{" "}
                {isAdmin ? (
                  <Link href={`/projects/${task.project.id}`} className="underline">
                    set them on the project page
                  </Link>
                ) : (
                  "ask an admin to set them"
                )}
              </>
            )}
          </div>
        )}
      {s.error && <div className={`${noticeW} text-[11px] text-red-600 dark:text-red-400`}>{s.error}</div>}
    </div>
  );
}

function BlockPanelBody({ s, size }: { s: TaskActions; size: Size }) {
  const wrap = size === "sm" ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-2";
  const field = size === "sm" ? "max-w-xs" : "";
  return (
    <div className={wrap}>
      <select
        className={`${fieldCls(size)} ${field}`}
        value={s.blockedReason}
        onChange={(e) => s.setBlockedReason(e.target.value)}
      >
        <option value="">Select a reason…</option>
        {BLOCKED_REASON_OPTIONS.map((reason) => (
          <option key={reason} value={reason}>
            {BLOCKED_REASON_LABELS[reason]}
          </option>
        ))}
      </select>
      <input
        type="text"
        className={`${fieldCls(size)} ${field}`}
        placeholder={s.blockedReason === "other" ? "Note (required)" : "Note (optional)"}
        value={s.blockedNote}
        onChange={(e) => s.setBlockedNote(e.target.value)}
      />
      <div className="flex gap-2">
        <button className={btnCls("secondary", size)} onClick={() => s.setPanel("none")} disabled={s.submitting}>
          Cancel
        </button>
        <button className={btnCls("primary", size)} onClick={s.confirmBlock} disabled={s.submitting}>
          {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Confirm block"}
        </button>
      </div>
    </div>
  );
}

function VisitUrgencyPanelBody({ s, size }: { s: TaskActions; size: Size }) {
  const wrap = size === "sm" ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-2";
  const field = size === "sm" ? "max-w-xs" : "";
  return (
    <div className={wrap}>
      <label className="text-xs font-medium text-fg-muted">Visit urgency (sets 1B&apos;s schedule)</label>
      <select
        className={`${fieldCls(size)} ${field}`}
        value={s.visitUrgency}
        onChange={(e) => s.setVisitUrgency(e.target.value)}
      >
        <option value="">Select…</option>
        <option value="emergency">Emergency (2 days)</option>
        <option value="hot">Hot (5 days)</option>
        <option value="cold">Cold (15 days)</option>
        <option value="site_not_ready">Site not ready (blocks 1B)</option>
      </select>
      {s.needsDelayCategory && (
        <select
          className={`${fieldCls(size)} ${field}`}
          value={s.delayCategory}
          onChange={(e) => s.setDelayCategory(e.target.value)}
        >
          <option value="">Reason for delay…</option>
          {DELAY_CATEGORY_OPTIONS.map((category) => (
            <option key={category} value={category}>
              {DELAY_CATEGORY_LABELS[category]}
            </option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <button className={btnCls("secondary", size)} onClick={() => s.setPanel("none")} disabled={s.submitting}>
          Cancel
        </button>
        <button
          className={btnCls("primary", size)}
          onClick={s.confirmVisitUrgency}
          disabled={s.submitting || s.needsLateReason || (s.needsDelayCategory && !s.delayCategory)}
        >
          {s.submitting ? <Spinner className={spinnerCls(size)} /> : "Confirm complete"}
        </button>
      </div>
    </div>
  );
}

// --- Desktop: one <tr> per task ---

function TaskRow({ task, isAdmin }: { task: UnifiedTask; isAdmin: boolean }) {
  const s = useTaskActions(task);

  return (
    <>
      <tr
        className={`border-b border-l-4 border-edge align-top last:border-b-0 transition-all duration-300 ease-in ${kindAccentCls(
          s.isServiceTask
        )} ${s.rowPhase === "success" ? "bg-emerald-500/15" : ""} ${
          s.rowPhase === "leaving" ? "-translate-y-1 opacity-0" : ""
        }`}
      >
        <td className="whitespace-nowrap px-3 py-2.5 text-xs text-fg-muted">
          {task.plannedDate ? (
            <span className={task.overrun ? "font-medium text-amber-700 dark:text-amber-400" : undefined}>
              {formatDate(task.plannedDate)}
              {task.overrun && <span className="block text-[11px]">Overdue {daysOverdue(task.plannedDate)}d</span>}
            </span>
          ) : (
            "—"
          )}
        </td>
        <td className="px-3 py-2.5">
          {isAdmin ? (
            <Link
              href={s.isServiceTask ? `/services/${task.project.id}` : `/projects/${task.project.id}`}
              className="text-sm font-medium text-fg hover:underline"
            >
              {task.project.name}
            </Link>
          ) : (
            <span className="text-sm font-medium text-fg">{task.project.name}</span>
          )}
          <div className="text-xs text-fg-muted">{task.project.client.name}</div>
        </td>
        <td className="px-3 py-2.5">
          <div className="text-sm font-medium text-fg">{task.taskLabel}</div>
          {task.subTaskLabel && <div className="text-xs text-fg-muted">{task.subTaskLabel}</div>}
          <div className="text-[10px] uppercase tracking-wide text-fg-muted">{formatPhase(task.phase)}</div>
          {s.isPhaseStep && task.status === "blocked" && task.blockedReason && (
            <div className="mt-1 text-xs text-red-600 dark:text-red-400">
              Blocked — {BLOCKED_REASON_LABELS[task.blockedReason]}
              {task.blockedNote ? `: ${task.blockedNote}` : ""}
            </div>
          )}
          {!s.canStartOrComplete && task.gateBlockedBy && (
            <div className="mt-1 text-xs text-fg-subtle">Waiting on: {task.gateBlockedBy.join(", ")}</div>
          )}
          {task.kind !== "contractor_selection" && s.isManualContractorStep && !s.needsContractor && (
            <div className="mt-1 text-xs text-fg-muted">Contractor: {task.contractorName}</div>
          )}
        </td>
        <td className="px-3 py-2.5">
          {task.kind === "contractor_selection" || task.kind === "planned_date_edit" || task.kind === "review_completed" ? (
            <span className="text-xs text-fg-subtle">—</span>
          ) : (
            <ActualDateField s={s} size="sm" />
          )}
        </td>
        <td className="px-3 py-2.5">
          {task.kind === "contractor_selection" || task.kind === "planned_date_edit" || task.kind === "review_completed" ? (
            <span className="text-xs text-fg-subtle">—</span>
          ) : (
            <ReasonField task={task} s={s} size="sm" />
          )}
        </td>
        <td className="px-3 py-2.5">
          {task.kind === "contractor_selection" ? (
            <ContractorActionField s={s} size="sm" />
          ) : task.kind === "planned_date_edit" ? (
            <PlannedDateEditField task={task} s={s} size="sm" />
          ) : task.kind === "review_completed" ? (
            <ReviewActionField s={s} size="sm" />
          ) : (
            <TaskActionCluster task={task} s={s} isAdmin={isAdmin} size="sm" />
          )}
        </td>
      </tr>

      {s.panel === "block" && (
        <tr className="border-b border-edge bg-overlay/40">
          <td colSpan={6} className="px-3 py-3">
            <BlockPanelBody s={s} size="sm" />
          </td>
        </tr>
      )}

      {s.panel === "visitUrgency" && (
        <tr className="border-b border-edge bg-overlay/40">
          <td colSpan={6} className="px-3 py-3">
            <VisitUrgencyPanelBody s={s} size="sm" />
          </td>
        </tr>
      )}
    </>
  );
}

// --- Mobile: one collapsible card per task ---

function TaskAccordionItem({ task, isAdmin }: { task: UnifiedTask; isAdmin: boolean }) {
  const s = useTaskActions(task);
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`overflow-hidden rounded-xl border border-l-4 border-edge transition-all duration-300 ease-in ${kindAccentCls(
        s.isServiceTask
      )} ${s.rowPhase === "success" ? "bg-emerald-500/15" : ""} ${
        s.rowPhase === "leaving" ? "-translate-y-1 opacity-0" : ""
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 p-3 text-left"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span
              className={`text-xs ${
                task.overrun ? "font-medium text-amber-700 dark:text-amber-400" : "text-fg-muted"
              }`}
            >
              {task.plannedDate ? formatDate(task.plannedDate) : "No planned date"}
            </span>
            {task.overrun && task.plannedDate && (
              <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-400">
                Overdue {daysOverdue(task.plannedDate)}d
              </span>
            )}
          </div>
          <div className="truncate text-sm font-medium text-fg">{task.project.name}</div>
          <div className="truncate text-xs text-fg-muted">
            {task.project.client.name} · {formatPhase(task.phase)}
          </div>
          <div className="text-sm text-fg">
            {task.taskLabel}
            {task.subTaskLabel ? <span className="text-fg-muted"> — {task.subTaskLabel}</span> : null}
          </div>
          {!open && s.isPhaseStep && task.status === "blocked" && (
            <div className="text-xs font-medium text-red-600 dark:text-red-400">Blocked</div>
          )}
        </div>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={2}
          className={`mt-0.5 h-5 w-5 shrink-0 stroke-current text-fg-muted transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        >
          <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-edge px-3 py-3">
          {s.isPhaseStep && task.status === "blocked" && task.blockedReason && (
            <div className="text-xs text-red-600 dark:text-red-400">
              Blocked — {BLOCKED_REASON_LABELS[task.blockedReason]}
              {task.blockedNote ? `: ${task.blockedNote}` : ""}
            </div>
          )}
          {!s.canStartOrComplete && task.gateBlockedBy && (
            <div className="text-xs text-fg-subtle">Waiting on: {task.gateBlockedBy.join(", ")}</div>
          )}
          {task.kind !== "contractor_selection" && s.isManualContractorStep && !s.needsContractor && (
            <div className="text-xs text-fg-muted">Contractor: {task.contractorName}</div>
          )}
          {isAdmin && (
            <Link
              href={s.isServiceTask ? `/services/${task.project.id}` : `/projects/${task.project.id}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
            >
              View {s.isServiceTask ? "service" : "project"}
              <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-3.5 w-3.5 stroke-current">
                <path d="M7 17 17 7M9 7h8v8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          )}
          {task.kind === "contractor_selection" ? (
            <ContractorActionField s={s} size="md" />
          ) : task.kind === "planned_date_edit" ? (
            <PlannedDateEditField task={task} s={s} size="md" />
          ) : task.kind === "review_completed" ? (
            <ReviewActionField s={s} size="md" />
          ) : (
            <>
              <ActualDateField s={s} size="md" label="Actual date" />
              <ReasonField task={task} s={s} size="md" label="Reason / note" />
              <TaskActionCluster task={task} s={s} isAdmin={isAdmin} size="md" />
            </>
          )}
          {s.panel === "block" && (
            <div className="rounded-lg bg-overlay/40 p-3">
              <BlockPanelBody s={s} size="md" />
            </div>
          )}
          {s.panel === "visitUrgency" && (
            <div className="rounded-lg bg-overlay/40 p-3">
              <VisitUrgencyPanelBody s={s} size="md" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

type KindFilter = "all" | "project" | "service";
type StatusFilter = "all" | "not_started" | "in_progress" | "delayed" | "blocked";

const STATUS_FILTER_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "not_started", label: "Not started" },
  { value: "in_progress", label: "In progress" },
  { value: "delayed", label: "Delayed" },
  { value: "blocked", label: "Blocked" },
];

const filterControlCls =
  "h-10 min-w-0 rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:h-8 sm:text-xs";

function taskMatchesKindFilter(task: UnifiedTask, filter: KindFilter): boolean {
  if (filter === "all") return true;
  // phase === "service" rather than kind === "service_item" — see isServiceTask's own comment
  // in useTaskActions for why a review_completed row needs the same check.
  const isService = task.phase === "service";
  return filter === "service" ? isService : !isService;
}

// A task's status as these filters think of it — deliberately loose, since several overlap (an
// in-progress step can also be overdue). "not_started"/"in_progress"/"blocked" are the row's
// stored StepStatus (every non-phase-step kind is hardcoded not_started — see unified-tasks.ts);
// "delayed" is the row's own overrun flag (past its planned date — the signal the "Overdue Nd"
// pill uses); "blocked" also covers a step stuck behind an unfinished dependency ("Waiting on …").
function taskMatchesStatusFilter(task: UnifiedTask, filter: StatusFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "not_started":
      return task.status === "not_started";
    case "in_progress":
      return task.status === "in_progress";
    case "delayed":
      return task.overrun;
    case "blocked":
      return task.status === "blocked" || (task.gateBlockedBy?.length ?? 0) > 0;
  }
}

export function TaskTable({ tasks, isAdmin = false }: { tasks: UnifiedTask[]; isAdmin?: boolean }) {
  // Filters live on every keystroke / change — no separate submit step. The list is already
  // just one department's own open tasks (never more than a couple hundred rows), so
  // re-filtering on each change is cheap enough to not need debouncing.
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const normalizedQuery = query.trim().toLowerCase();
  const filtersActive = normalizedQuery !== "" || kindFilter !== "all" || statusFilter !== "all";
  const visibleTasks = tasks.filter(
    (task) =>
      (!normalizedQuery || taskSearchText(task).includes(normalizedQuery)) &&
      taskMatchesKindFilter(task, kindFilter) &&
      taskMatchesStatusFilter(task, statusFilter)
  );

  function clearFilters() {
    setQuery("");
    setKindFilter("all");
    setStatusFilter("all");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search project, service, client, task, phase, department…"
          className="h-10 w-full max-w-sm min-w-0 rounded-lg border border-edge bg-bg px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:h-8 sm:px-2 sm:text-xs"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value as KindFilter)}
          aria-label="Filter by project or service"
          className={filterControlCls}
        >
          <option value="all">All work</option>
          <option value="project">Projects only</option>
          <option value="service">Services only</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          aria-label="Filter by status"
          className={filterControlCls}
        >
          {STATUS_FILTER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {filtersActive && (
          <>
            <button type="button" className={`${btnCls("secondary", "sm")} h-10 sm:h-8`} onClick={clearFilters}>
              Clear
            </button>
            <span className="text-xs text-fg-muted">
              {visibleTasks.length} of {tasks.length}
            </span>
          </>
        )}
      </div>

      {/* Mobile: collapsible cards — header carries planned date, project/service and task; the
          rest of the row (date, reason, actions) lives in the expanded body. */}
      <div className="flex flex-col gap-2 sm:hidden">
        {visibleTasks.length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge-2 py-8 text-center text-sm text-fg-muted">
            No tasks match these filters.
          </p>
        ) : (
          visibleTasks.map((task) => <TaskAccordionItem key={task.id} task={task} isAdmin={isAdmin} />)
        )}
      </div>

      {/* Desktop: full table */}
      <div className="hidden overflow-x-auto rounded-xl border border-edge sm:block">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="bg-surface text-[11px] uppercase tracking-wider text-fg-subtle">
            <tr>
              <th className="px-3 py-2.5 font-medium">Planned date</th>
              <th className="px-3 py-2.5 font-medium">Project / Service</th>
              <th className="w-64 px-3 py-2.5 font-medium">Task</th>
              <th className="w-32 px-3 py-2.5 font-medium">Actual date</th>
              <th className="w-56 px-3 py-2.5 font-medium">Reason</th>
              <th className="px-3 py-2.5 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-surface">
            {visibleTasks.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-fg-muted">
                  No tasks match these filters.
                </td>
              </tr>
            ) : (
              visibleTasks.map((task) => <TaskRow key={task.id} task={task} isAdmin={isAdmin} />)
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
