"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MyTaskItem } from "@/lib/my-tasks";
import { isDueToday } from "@/lib/overrun";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";
import { Spinner } from "@/components/ui/Spinner";
import {
  STEP_STATUS_LABELS,
  STEP_STATUS_COLORS,
  BLOCKED_REASON_LABELS,
  BLOCKED_REASON_OPTIONS,
  DELAY_CATEGORY_LABELS,
  DELAY_CATEGORY_OPTIONS,
  DEPARTMENT_LABELS,
  ASSIGNABLE_DEPARTMENTS,
  PHASE_LABELS,
} from "@/lib/labels";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(iso));
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

// Some browsers only open the native calendar when the small icon is clicked, not
// the rest of the field — showPicker() makes the whole input open it on any click.
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

const DATE_FIELDS: { key: "actualStartDate" | "actualEndDate"; label: string }[] = [
  { key: "actualStartDate", label: "Actual start" },
  { key: "actualEndDate", label: "Actual end" },
];

// Steps whose actual start isn't worth showing as an editable field — either because the
// work happens in a single day (1A, 1B: the actual work, not the planned window leading up
// to it, starts and finishes the same day), because it's entirely system-derived and never
// meant to be hand-edited (2A: always set to its own planned finish the moment real progress
// begins — see syncDerivedStepStatus in step-actions.ts), because it's auto-stamped the
// moment the dependency before it completes (1C, 1D — see autoStartStep in step-actions.ts),
// or because only its completion date is worth tracking (2D2, 3E — a single on-site QC check;
// 3B — a single "Actual arrival" date on the glass PO tracker, no separate start). Either way,
// only the completion date is meaningful to show here.
const SINGLE_DATE_FIELD_STEP_CODES = new Set(["1A", "1B", "1C", "1D", "2A", "2D2", "3B", "3E"]);

// 3A's status/actual start/actual end, and 3B's status/actual end (and planned end — see
// syncGlassPOStepStatus's newPlannedEnd), are all driven by the glass PO tracker beneath them
// — but unlike the isDerived steps (2A/2D1/2F), they still show their own Actual date field(s),
// just disabled, rather than hiding them outright. Kept local for the same reason
// DELAY_CATEGORY_STEP_CODES below is: step-actions.ts's own copy of this concept pulls in the
// Prisma client, which this "use client" file can't import.
const GLASS_PO_STEP_CODES = new Set(["3A", "3B"]);
// 3A shows both Actual start (Requirement created) and Actual end (Order confirmed); 3B only
// ever had one meaningful date (Actual arrival) — see SINGLE_DATE_FIELD_STEP_CODES above.
const GLASS_PO_HINT: Record<string, string> = {
  "3A": "Auto-filled from the Glass PO tracker below — Requirement created / Order confirmed.",
  "3B": "Auto-filled from the Glass PO tracker below — Actual arrival.",
};

// Phase 3 mostly never gets a computed planned date (see rescheduleProjectDates's phase_3
// exclusion) — 3C1 and 3E are the steps that still get a manual Planned date each, filled in by
// hand via their own small Save CTA, same "plain freeform field, not a forecast" idea as the
// Glass PO tracker's Planned column. Once set, the inputs lock — see plannedDatesLocked below.
// 3C2 ("Installation") is the one Phase 3 step that IS computed — from the Installation planned
// window (see computeInstallationPlannedWindow in procurement.ts) — so it's deliberately left out
// of this set and falls through to the same read-only planned-date display every other computed
// step gets. Kept local rather than imported from step-actions.ts's own copy of this same set,
// for the same reason DELAY_CATEGORY_STEP_CODES above is — that file pulls in the Prisma client.
const MANUAL_PLANNED_DATE_STEP_CODES = new Set(["3C1", "3E"]);

// Of those, 3E only gets a Planned *end* — a single on-site QC check has no meaningful planned
// start to fill in separately (same reasoning as its Actual date being end-only, just above).
// 3C1 keeps the full start+end pair since that's a genuinely multi-day span of work.
const MANUAL_PLANNED_END_ONLY_STEP_CODES = new Set(["3E"]);

// 3C1 ("Aluminum framework") only, for now — which crew is fabricating it, chosen alongside that
// step's own manual Planned start/end in the same Save CTA and locked in with them. A subset of
// MANUAL_PLANNED_DATE_STEP_CODES, not every step in it: 3E is a QC check the project engineer
// does themselves, not contracted-out work, so it has no contractor field. Kept local rather than
// imported from step-actions.ts's own copy, for the same reason every other set here is.
const MANUAL_CONTRACTOR_STEP_CODES = new Set(["3C1"]);

// Steps that skip the Start->Mark complete two-click flow at not_started and jump straight to
// a single completion button. Includes 1A/1B plus 1D, which — like 1B and 1C —
// auto-starts the moment its dependency completes (see autoStartStep in step-actions.ts), so a
// project moving through the normal flow never actually sees it sit at not_started. This only
// matters for legacy data that reached 1D before that auto-start existed, where it's still
// stuck at not_started: even there it should offer one click, not two.
//
// 2D2 is here for a different reason: a single on-site measurement visit has no meaningful
// "started" moment worth a separate click, so it never gets a Start button at all — see the
// per-step button label below, and displayStatus further down for how its badge still shows
// "In progress" once overdue despite the stored status staying not_started throughout.
const SINGLE_COMPLETION_STEP_CODES = new Set(["1A", "1B", "1D", "2D2"]);

// Steps whose late completion asks for a client-side/in-house delay reason. Kept local rather
// than imported — step-actions.ts (which owns the server-side copy of this same set, as
// DELAY_CATEGORY_STEP_CODES) pulls in the Prisma client, which a "use client" file can't import
// — so this must be kept in sync with that set by hand.
const DELAY_CATEGORY_STEP_CODES = new Set(["1A", "1B", "1C", "1D", "2D2"]);

// 3E's completion is a QC outcome, not a plain "done" — Pass/Fail replace the usual single
// Mark complete button, same idea as the fixed "qc" row's own button pair in
// ProcurementTracker/GlassTracker. Unlike those trackers, a Fail here doesn't complete the step
// at all (see handleQCOutcome) — 3E stays in_progress, and the action plan + custom follow-up
// rows it unlocks live in a separate SiteQCTracker component below this card.
const QC_STEP_CODES = new Set(["3E"]);

const btnPrimary =
  "flex-1 flex h-11 items-center justify-center rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-40";
const btnSecondary =
  "flex-1 flex h-11 items-center justify-center rounded-lg border border-edge px-3 text-sm font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg disabled:opacity-40";
const btnDanger =
  "flex-1 flex h-11 items-center justify-center rounded-lg border border-red-300 px-3 text-sm font-medium text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10";
const btnAdminSmall =
  "flex flex-1 h-9 items-center justify-center rounded-lg border border-edge px-3 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:text-fg";
const selectClass =
  "h-11 w-full rounded-lg border border-edge bg-bg px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const textareaClass =
  "w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

const STATUS_ICON_WRAP: Record<string, string> = {
  not_started: "bg-overlay text-fg-subtle ring-1 ring-inset ring-edge",
  in_progress: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/25",
  blocked: "bg-red-50 text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25",
  completed: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
};

function StatusIcon({ status, className }: { status: string; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", strokeWidth: 2, className };
  if (status === "completed") {
    return (
      <svg {...common}>
        <path d="M5 12.5 10 17l9-10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "blocked") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M6.4 6.4 17.6 17.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "in_progress") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.5" strokeDasharray="3 3" />
    </svg>
  );
}

// A restore/history glyph (circular arrow + clock hands) rather than the plain clock used for
// "in progress" above — this marks a step that has been flagged overdue before, which is a
// distinct signal from its current status and shouldn't read as another status icon.
function HistoryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className={className}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.7-6.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3.5 4.5v4h4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7.5V12l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type Panel = "none" | "block" | "complete1a" | "revert";

interface RevertPlan {
  step: { stepCode: string; stepName: string; status: keyof typeof STEP_STATUS_LABELS };
  toStatus: keyof typeof STEP_STATUS_LABELS;
  cascade: { stepCode: string; stepName: string; status: keyof typeof STEP_STATUS_LABELS }[];
  procurementReset: { stepCodes: string[]; clears: string[]; fullReset: boolean } | null;
  projectDataClears: string[];
  clearsStepNotes: boolean;
  needsConsent: boolean;
  phaseChange: { from: string; to: string } | null;
}

/** "2A", "2A and 2D1", "2A, 2D1 and 2F" */
function formatStepList(codes: string[]): string {
  if (codes.length <= 1) return codes.join("");
  return `${codes.slice(0, -1).join(", ")} and ${codes[codes.length - 1]}`;
}

export function TaskCard({
  item,
  showDepartment = false,
  canEditDates = false,
  canRevert = false,
}: {
  item: MyTaskItem;
  showDepartment?: boolean;
  canEditDates?: boolean;
  canRevert?: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("none");
  const [revertPlan, setRevertPlan] = useState<RevertPlan | null>(null);
  const [clearProcurement, setClearProcurement] = useState(false);
  const [blockedReason, setBlockedReason] = useState("");
  const [blockedNote, setBlockedNote] = useState("");
  const [visitUrgency, setVisitUrgency] = useState("");
  const [delayCategory, setDelayCategory] = useState("");
  // A plain useState would only ever seed this on first mount. router.refresh() re-fetches
  // server data and passes this same card fresh props (same item.id, so React reuses the
  // instance rather than remounting it) — useSyncedDraft is what makes a value computed
  // server-side after this card mounted (e.g. this step's actual start auto-filled once its
  // dependency completes) show up here without a full page reload.
  const [dateFields, setDateFields] = useSyncedDraft(
    `${item.actualStartDate ?? ""}|${item.actualEndDate ?? ""}`,
    () => ({
      actualStartDate: toDateInputValue(item.actualStartDate),
      actualEndDate: toDateInputValue(item.actualEndDate),
    })
  );
  const [dateSubmitting, setDateSubmitting] = useState(false);
  const [dateMessage, setDateMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  // 3C1's manual Planned start/end — a separate draft and save action from the Actual dates
  // above, since these are meant to be filled in and locked in *before* work (and its Actual
  // dates) begins, not bundled into the same click. Contractor is its own separate task now
  // (see contractorDraft below) — a project engineer's own call, not bundled with these dates.
  const [plannedDateFields, setPlannedDateFields] = useSyncedDraft(
    `${item.plannedStartDate ?? ""}|${item.plannedEndDate ?? ""}`,
    () => ({
      plannedStartDate: toDateInputValue(item.plannedStartDate),
      plannedEndDate: toDateInputValue(item.plannedEndDate),
    })
  );
  const [plannedDateSubmitting, setPlannedDateSubmitting] = useState(false);
  const [plannedDateError, setPlannedDateError] = useState<string | null>(null);
  const [plannedDateSaved, setPlannedDateSaved] = useState(false);
  // Admin-only: which department (if any) this step's own manual Planned start/end has been
  // delegated to — see plannedDateEditDepartment and savePlannedDatePermission below. A separate
  // draft/save from the dates themselves, same "who may vs. what's saved" split as the contractor
  // picker above is from its own dates.
  const [plannedDateEditDeptDraft, setPlannedDateEditDeptDraft] = useSyncedDraft(
    item.plannedDateEditDepartment ?? "",
    (v) => v ?? ""
  );
  const [plannedDatePermissionSubmitting, setPlannedDatePermissionSubmitting] = useState(false);
  const [plannedDatePermissionError, setPlannedDatePermissionError] = useState<string | null>(null);
  const [plannedDatePermissionSaved, setPlannedDatePermissionSaved] = useState(false);
  // 3C1's own contractor pick — a separate draft/save action (POST /api/phase-steps/[id]/contractor)
  // from the Planned dates above. See contractorPickerOpen further down.
  const [contractorDraft, setContractorDraft] = useSyncedDraft(item.contractorId ?? "", (v) => v ?? "");
  const [contractorSubmitting, setContractorSubmitting] = useState(false);
  const [contractorError, setContractorError] = useState<string | null>(null);
  const [contractorSaved, setContractorSaved] = useState(false);
  const [contractors, setContractors] = useState<{ id: string; name: string }[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/phase-steps/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.detail?.blockedBy ? ` (waiting on: ${data.detail.blockedBy.join(", ")})` : "";
        setError((typeof data.error === "string" ? data.error : "Update failed") + detail);
        setSubmitting(false);
        return;
      }
      setPanel("none");
      setNote("");
      setDelayCategory("");
      router.refresh();
      setSubmitting(false);
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  // Pushes whatever's currently in the (visible) date inputs, silently — errors surface
  // through the same banner as the status change it's bundled with, not a separate one.
  async function pushDatesSilently(): Promise<boolean> {
    const body: Record<string, unknown> = {};
    for (const { key } of visibleDateFields) {
      body[key] = dateFields[key] ? new Date(dateFields[key]).toISOString() : null;
    }
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/dates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Could not save dates");
        return false;
      }
      return true;
    } catch {
      setError("Could not reach the server");
      return false;
    }
  }

  // Admins get one button, not two: whatever's in the date fields is saved as part of the
  // same click that changes status, instead of requiring a separate "save dates" submit first.
  async function submitWithDates(body: Record<string, unknown>) {
    if (canEditDates) {
      setSubmitting(true);
      setError(null);
      if (!(await pushDatesSilently())) {
        setSubmitting(false);
        return;
      }
    }
    await submit(body);
  }

  function startStep() {
    submitWithDates({ status: "in_progress", notes: note || undefined });
  }

  function resumeStep() {
    submitWithDates({ status: "in_progress", notes: note || undefined });
  }

  // Only meaningful when canEditDates: that's the only case where an actual-end value is
  // sitting in this form waiting to be submitted at all (see submitWithDates) — a regular
  // department user without date-editing rights has no field to have left blank.
  function validateActualEnd(): boolean {
    if (canEditDates && !dateFields.actualEndDate) {
      setError("Actual end date is required to mark this step complete");
      return false;
    }
    return true;
  }

  function completeStep() {
    if (item.stepCode === "1A") {
      setPanel("complete1a");
      return;
    }
    if (!validateActualEnd()) return;
    if (needsLateReason) {
      setError("Actual end is after the planned finish — add a note explaining why before marking complete");
      return;
    }
    if (needsDelayCategory) {
      setError("Choose whether the delay was client side or in house before marking complete");
      return;
    }
    submitWithDates({
      status: "completed",
      notes: note || undefined,
      delayCategory: delayCategory || undefined,
    });
  }

  // 3E only. A Pass completes the step exactly like completeStep above, just with qcPassed
  // riding along. A Fail is deliberately a plain field edit, not a status transition — see
  // /api/phase-steps/[id] — so it goes through the plain submit() rather than submitWithDates,
  // and needs its own note requirement rather than reusing needsLateReason/needsDelayCategory
  // (a QC failure needs explaining unconditionally, whether or not it's also late).
  function handleQCOutcome(passed: boolean) {
    if (passed) {
      if (!validateActualEnd()) return;
      if (needsLateReason) {
        setError("Actual end is after the planned finish — add a note explaining why before marking complete");
        return;
      }
      if (needsDelayCategory) {
        setError("Choose whether the delay was client side or in house before marking complete");
        return;
      }
      submitWithDates({
        status: "completed",
        qcPassed: true,
        notes: note || undefined,
        delayCategory: delayCategory || undefined,
      });
      return;
    }
    if (!note.trim()) {
      setError("A note is required when QC fails");
      return;
    }
    submit({ qcPassed: false, notes: note });
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
    submit({ status: "blocked", blockedReason, blockedNote: blockedNote || undefined });
  }

  function confirmComplete1A() {
    if (!visitUrgency) {
      setError("Choose the visit urgency");
      return;
    }
    if (!validateActualEnd()) return;
    if (needsLateReason) {
      setError("Actual end is after the planned finish — add a note explaining why before marking complete");
      return;
    }
    if (needsDelayCategory) {
      setError("Choose whether the delay was client side or in house before marking complete");
      return;
    }
    submitWithDates({
      status: "completed",
      visitUrgency,
      notes: note || undefined,
      delayCategory: delayCategory || undefined,
    });
  }

  // The preview is fetched rather than precomputed for every card, since a revert's blast
  // radius depends on the whole project's live dependency graph and only matters once asked for.
  async function openRevert() {
    setPanel("revert");
    setRevertPlan(null);
    setClearProcurement(false);
    setError(null);
    setNote("");
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/revert`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not work out what this would affect");
        return;
      }
      setRevertPlan(data as RevertPlan);
    } catch {
      setError("Could not reach the server");
    }
  }

  async function confirmRevert() {
    if (!note.trim()) {
      setError("A reason is required — it goes on the step's history");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/revert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason: note.trim(),
          ...(clearProcurement ? { clearDerivedProcurement: true } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Revert failed");
        setSubmitting(false);
        return;
      }
      setPanel("none");
      setNote("");
      setRevertPlan(null);
      setClearProcurement(false);
      router.refresh();
      setSubmitting(false);
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  function dismissDateMessageAfter(ms: number) {
    setTimeout(() => setDateMessage((prev) => (prev ? null : prev)), ms);
  }

  // Shared by savePlannedDates/savePlannedDatePermission/saveContractor below — none of them
  // remove this card the way a completed task's row disappears elsewhere (my-tasks/TaskTable.tsx),
  // so "done" here means a brief "Saved" flash rather than a fade-out. Delayed past the refresh
  // (same reasoning as saveDates' own dateMessage above) so it's actually visible before this
  // card's fields update out from under it.
  function flashSavedThenRefresh(setSaved: (v: boolean) => void) {
    setSaved(true);
    setTimeout(() => {
      setSaved(false);
      router.refresh();
    }, 1200);
  }

  async function saveDates() {
    setDateSubmitting(true);
    setDateMessage(null);
    const body: Record<string, unknown> = { note: note || undefined };
    for (const { key } of DATE_FIELDS) {
      body[key] = dateFields[key] ? new Date(dateFields[key]).toISOString() : null;
    }
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/dates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDateMessage({ type: "error", text: typeof data.error === "string" ? data.error : "Update failed" });
        setDateSubmitting(false);
        dismissDateMessageAfter(5000);
        return;
      }
      setDateMessage({ type: "success", text: "Dates updated" });
      setNote("");
      setDateSubmitting(false);
      // Delayed so the success message is actually visible before router.refresh()'s
      // re-render can remount this card and reset it away.
      setTimeout(() => router.refresh(), 3000);
      dismissDateMessageAfter(3000);
    } catch {
      setDateMessage({ type: "error", text: "Could not reach the server" });
      setDateSubmitting(false);
      dismissDateMessageAfter(5000);
    }
  }

  async function savePlannedDates() {
    setPlannedDateSubmitting(true);
    setPlannedDateError(null);
    setPlannedDateSaved(false);
    const plannedDatesEndOnly = MANUAL_PLANNED_END_ONLY_STEP_CODES.has(item.stepCode);
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/dates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // 3E never had a Planned start field to begin with — leaving the key out entirely
          // keeps this a no-op on that column instead of writing null over nothing.
          ...(plannedDatesEndOnly
            ? {}
            : {
                plannedStartDate: plannedDateFields.plannedStartDate
                  ? new Date(plannedDateFields.plannedStartDate).toISOString()
                  : null,
              }),
          plannedEndDate: plannedDateFields.plannedEndDate
            ? new Date(plannedDateFields.plannedEndDate).toISOString()
            : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannedDateError(typeof data.error === "string" ? data.error : "Could not save planned dates");
        setPlannedDateSubmitting(false);
        return;
      }
      setPlannedDateSubmitting(false);
      flashSavedThenRefresh(setPlannedDateSaved);
    } catch {
      setPlannedDateError("Could not reach the server");
      setPlannedDateSubmitting(false);
    }
  }

  // 3C2 only — clears plannedStartDateOverride/plannedEndDateOverride (see
  // INSTALLATION_OVERRIDE_STEP_CODE in step-actions.ts) so this step goes back to tracking the
  // Installation planned window automatically. Safe to call whether or not an override is
  // currently set — the server writes null either way, a no-op when there wasn't one.
  async function resetPlannedDatesToAuto() {
    setPlannedDateSubmitting(true);
    setPlannedDateError(null);
    setPlannedDateSaved(false);
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/dates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plannedStartDate: null, plannedEndDate: null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannedDateError(typeof data.error === "string" ? data.error : "Could not reset planned dates");
        setPlannedDateSubmitting(false);
        return;
      }
      setPlannedDateSubmitting(false);
      flashSavedThenRefresh(setPlannedDateSaved);
    } catch {
      setPlannedDateError("Could not reach the server");
      setPlannedDateSubmitting(false);
    }
  }

  async function savePlannedDatePermission() {
    setPlannedDatePermissionSubmitting(true);
    setPlannedDatePermissionError(null);
    setPlannedDatePermissionSaved(false);
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/planned-date-permission`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department: plannedDateEditDeptDraft || null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPlannedDatePermissionError(typeof data.error === "string" ? data.error : "Could not save");
        setPlannedDatePermissionSubmitting(false);
        return;
      }
      setPlannedDatePermissionSubmitting(false);
      flashSavedThenRefresh(setPlannedDatePermissionSaved);
    } catch {
      setPlannedDatePermissionError("Could not reach the server");
      setPlannedDatePermissionSubmitting(false);
    }
  }

  async function saveContractor() {
    if (!contractorDraft) {
      setContractorError("Choose a contractor");
      return;
    }
    setContractorSubmitting(true);
    setContractorError(null);
    setContractorSaved(false);
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/contractor`, {
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
      setContractorSubmitting(false);
      flashSavedThenRefresh(setContractorSaved);
    } catch {
      setContractorError("Could not reach the server");
      setContractorSubmitting(false);
    }
  }

  const canStartOrComplete = item.gateBlockedBy === null || item.gateBlockedBy.length === 0;
  // What actually gets saved as the actual-end value if a completion action is submitted
  // right now — the date field's current value, or today if it's empty (mirrors the server's
  // own default-to-now guard in updateStepStatus). Comparing against that, not just today, is
  // what lets a deliberately-backdated late entry still require a reason even when the field
  // wasn't left empty. Same rule as the procurement tracker's per-row "Mark complete" gate.
  const effectiveActualEndDate = dateFields.actualEndDate || toDateInputValue(new Date().toISOString());
  const isLateCompletion =
    canEditDates && !!item.plannedEndDate && effectiveActualEndDate > toDateInputValue(item.plannedEndDate);
  const needsLateReason = isLateCompletion && !note.trim();
  // A late completion of one of DELAY_CATEGORY_STEP_CODES also needs to say whether the delay
  // was the client's or the team's — reschedule.ts uses that, generically, to decide whether
  // the next step's planned finish moves with it.
  const needsDelayCategoryChoice = DELAY_CATEGORY_STEP_CODES.has(item.stepCode) && isLateCompletion;
  const needsDelayCategory = needsDelayCategoryChoice && !delayCategory;
  const isGlassPO = GLASS_PO_STEP_CODES.has(item.stepCode);
  const hasManualPlannedDates = MANUAL_PLANNED_DATE_STEP_CODES.has(item.stepCode);
  // 3C2 only — see INSTALLATION_OVERRIDE_STEP_CODE in step-actions.ts (kept local for the usual
  // reason: that file pulls in the Prisma client). Deliberately not part of hasManualPlannedDates
  // above: this step's planned dates are never empty (they default to the Installation planned
  // window) and never lock — the edit form below stays open the whole time, unlike 3C1/3E's.
  const isInstallationOverride = item.stepCode === "3C2";
  const hasManualContractor = MANUAL_CONTRACTOR_STEP_CODES.has(item.stepCode);
  const plannedDatesEndOnly = MANUAL_PLANNED_END_ONLY_STEP_CODES.has(item.stepCode);
  // Once the relevant field(s) are saved they're locked in — no more casual re-editing through
  // this form. End-only steps (3E) only ever need their Planned end filled before locking.
  const plannedDatesLocked = plannedDatesEndOnly ? !!item.plannedEndDate : !!item.plannedStartDate && !!item.plannedEndDate;
  const contractorLocked = !!item.contractorId;
  // Fetched once the picker is actually reachable — a locked-in row shows item.contractorName
  // instead (see the select's own fallback option below), so there's nothing to fetch a live
  // list for once this is no longer editable.
  const contractorPickerOpen = canEditDates && hasManualContractor && !contractorLocked;
  useEffect(() => {
    if (!contractorPickerOpen) return;
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
  }, [contractorPickerOpen]);
  // Start/Mark complete are disabled until both the Planned dates *and* (for 3C1) the contractor
  // are saved — two independent CTAs now (see saveContractor/savePlannedDates above), but the
  // step itself still can't begin without either: you can't schedule installation without dates,
  // and you can't schedule it with a contractor no one's confirmed yet.
  const blockedByUnsavedPlannedDates =
    hasManualPlannedDates && !(plannedDatesLocked && (!hasManualContractor || contractorLocked));
  // Whichever of the two is still outstanding — checked in the order a project engineer would
  // naturally tackle them (contractor first, per the section above the planned dates one).
  const plannedDatesHint =
    hasManualContractor && !contractorLocked
      ? "Select a contractor above first"
      : "Save the planned dates above first";
  const visibleDateFields = SINGLE_DATE_FIELD_STEP_CODES.has(item.stepCode)
    ? DATE_FIELDS.filter((f) => f.key !== "actualStartDate")
    : DATE_FIELDS;
  // When there's a status button coming up below (Start/Mark complete/Resume), date edits
  // ride along with that single click instead of needing their own separate save — see
  // submitWithDates. Only steps with no such button (completed, derived, glass PO) keep the
  // standalone save-dates control, since nothing else would ever submit their date edits.
  const hasStatusAction = !item.isDerived && !isGlassPO && item.status !== "completed";
  // Same condition as the "Overdue" pill below — blocked steps already get their own red
  // treatment via the blocked-reason banner, so this doesn't pile an amber highlight on top.
  const isOverdueCard = item.overrun && item.status !== "blocked";
  // item.overrun is already calendar-day-aware (see overrun.ts) — false for a step due today, so
  // this only ever fires for the one day it's neither overdue nor "not due yet". Computed here
  // from the same plannedEndDate the card already has, same as isDueToday's own doc comment
  // describes for every other client component that needs this.
  const isDueTodayCard = !item.overrun && item.status !== "blocked" && item.status !== "completed" && isDueToday(item.plannedEndDate);
  const contractorDueToday =
    !item.contractorOverdue && !item.contractorId && isDueToday(item.contractorPlannedDate);
  // 2D2 has no Start action (see SINGLE_COMPLETION_STEP_CODES above), so its stored status can
  // only ever be not_started or completed — nothing ever sets it to in_progress. Once its
  // planned finish passes with nothing recorded yet, show the badge as "In progress" anyway
  // rather than leaving it looking untouched; purely cosmetic, the stored value is unaffected
  // and the single completion button below already works off item.status directly.
  const displayStatus =
    item.stepCode === "2D2" && item.status === "not_started" && item.overrun ? "in_progress" : item.status;
  // This step itself finished after its own planned finish — a stronger, more specific signal
  // than "was flagged overdue at some point" once it's actually done, so it takes over from the
  // history color rather than stacking. delay_category (the "In house delay"/"Client side
  // delay" box below) is only ever asked for on DELAY_CATEGORY_STEP_CODES and always implies
  // this, but plenty of other steps can also complete late without ever having a category
  // recorded against them — this covers both.
  const isDelayedCompletion =
    item.status === "completed" &&
    !!item.actualEndDate &&
    !!item.plannedEndDate &&
    item.actualEndDate > item.plannedEndDate;
  const daysLate = isDelayedCompletion
    ? Math.round(
        (new Date(item.actualEndDate!).getTime() - new Date(item.plannedEndDate!).getTime()) / (1000 * 60 * 60 * 24)
      )
    : 0;
  // A distinct, calmer color from the amber "overdue right now" state — this step has slipped
  // before but isn't currently the urgent one, so it shouldn't compete for the same attention.
  const hasDelayHistory = !isOverdueCard && !isDelayedCompletion && item.timesOverdue > 0;
  // This step didn't slip itself, but something upstream of it did (see the note under Planned
  // finish below) — the mildest of the four signals, so it only shows when nothing above applies.
  const isUpstreamAffected = !isOverdueCard && !isDelayedCompletion && !hasDelayHistory && !!item.upstreamDelay;

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        isOverdueCard
          ? "border-amber-500/50 bg-amber-500/5 dark:border-amber-500/40 dark:bg-amber-500/[0.04]"
          : isDelayedCompletion
            ? "border-rose-500/50 bg-rose-500/10 dark:border-rose-500/40 dark:bg-rose-500/[0.08]"
            : hasDelayHistory
              ? "border-violet-500/50 bg-violet-500/20 dark:border-violet-500/40 dark:bg-violet-500/[0.16]"
              : isUpstreamAffected
                ? "border-cyan-500/50 bg-cyan-500/5 dark:border-cyan-500/40 dark:bg-cyan-500/[0.04]"
                : "border-edge bg-surface"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${STATUS_ICON_WRAP[displayStatus]}`}>
            <StatusIcon status={displayStatus} className="h-5 w-5 stroke-current" />
          </span>
          <div>
            <Link
              href={`/projects/${item.project.id}`}
              className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
            >
              {item.project.name}
            </Link>
            <div className="mt-0.5">
              <span className="font-mono text-xs text-fg-subtle">{item.stepCode}</span>{" "}
              <span className="font-medium text-fg">{item.stepName}</span>
            </div>
            {showDepartment && (
              <span className="mt-1 inline-block rounded-full bg-overlay px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-edge">
                {DEPARTMENT_LABELS[item.owningDepartment]}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STEP_STATUS_COLORS[displayStatus]}`}>
            {STEP_STATUS_LABELS[displayStatus]}
          </span>
          {item.overrun && item.status !== "blocked" && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              Overdue
            </span>
          )}
          {isDueTodayCard && (
            <span className="rounded-full bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-inset ring-sky-500/25 dark:text-sky-400">
              Due today
            </span>
          )}
          {item.timesOverdue > 0 && (
            <span
              title={`Flagged overdue ${item.timesOverdue} time${item.timesOverdue === 1 ? "" : "s"}${
                item.lastOverdueAt ? ` · most recently ${formatDate(item.lastOverdueAt)}` : ""
              }`}
              className="flex items-center gap-1 rounded-full bg-overlay px-2 py-0.5 text-xs font-medium text-fg-muted ring-1 ring-inset ring-edge"
            >
              <HistoryIcon className="h-3 w-3 stroke-current" />
              {item.timesOverdue}×
            </span>
          )}
          {item.reviewedAt && (
            <span
              title={`Reviewed ${formatDate(item.reviewedAt)}${item.reviewNote ? ` — "${item.reviewNote}"` : ""}`}
              className="rounded-full bg-violet-500/10 px-2 py-0.5 text-xs font-medium text-violet-700 ring-1 ring-inset ring-violet-500/25 dark:text-violet-400"
            >
              Reviewed
            </span>
          )}
        </div>
      </div>

      {hasManualContractor && (
        <div
          className={`flex flex-col gap-2 rounded-lg border p-3 ${
            item.contractorOverdue
              ? "border-amber-500/50 bg-amber-500/10 dark:border-amber-500/40 dark:bg-amber-500/[0.08]"
              : "border-edge bg-overlay/40"
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-fg-muted">Contractor</span>
            {item.contractorPlannedDate && (
              <span
                className={`text-xs ${
                  item.contractorOverdue
                    ? "font-medium text-amber-700 dark:text-amber-400"
                    : contractorDueToday
                      ? "font-medium text-sky-700 dark:text-sky-400"
                      : "text-fg-subtle"
                }`}
              >
                Target: {formatDate(item.contractorPlannedDate)}
                {item.contractorOverdue ? " — overdue" : contractorDueToday ? " — due today" : ""}
              </span>
            )}
          </div>
          {contractorLocked ? (
            <p className="text-sm text-fg">{item.contractorName}</p>
          ) : canEditDates ? (
            <>
              <select
                value={contractorDraft}
                onChange={(e) => setContractorDraft(e.target.value)}
                className="h-10 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
              >
                <option value="">Select contractor…</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={saveContractor}
                  disabled={contractorSubmitting}
                  className={`${btnAdminSmall} disabled:opacity-40`}
                >
                  {contractorSubmitting ? <Spinner className="h-3.5 w-3.5" /> : "Save contractor"}
                </button>
              </div>
              {contractorSaved && <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved</p>}
              {contractorError && <p className="text-xs text-red-600 dark:text-red-400">{contractorError}</p>}
            </>
          ) : (
            <p className="text-xs text-fg-subtle">Not selected yet.</p>
          )}
        </div>
      )}

      <div className="text-xs text-fg-muted">Planned finish: {formatDate(item.plannedEndDate)}</div>

      {item.upstreamDelay && (
        <div className="text-xs text-fg-subtle">
          {DELAY_CATEGORY_LABELS[item.upstreamDelay.category as keyof typeof DELAY_CATEGORY_LABELS]} on{" "}
          {item.upstreamDelay.stepCode} —{" "}
          {item.upstreamDelay.category === "in_house"
            ? "this step's schedule wasn't pushed out"
            : "this step's schedule shifted to match"}
        </div>
      )}

      {item.timesOverdue > 0 && (
        <div className="text-xs text-fg-subtle">
          Overdue history — flagged {item.timesOverdue} time{item.timesOverdue === 1 ? "" : "s"}
          {item.lastOverdueAt && `, most recently ${formatDate(item.lastOverdueAt)}`}
        </div>
      )}

      {item.status === "blocked" && item.blockedReason && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
          <div className="font-medium">
            {BLOCKED_REASON_LABELS[item.blockedReason as keyof typeof BLOCKED_REASON_LABELS]}
            {item.daysBlocked !== null && ` · blocked ${item.daysBlocked}d`}
          </div>
          {item.blockedNote && <div className="mt-0.5">{item.blockedNote}</div>}
        </div>
      )}

      {QC_STEP_CODES.has(item.stepCode) && item.qcPassed === false && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
          Failed QC — see the action plan below. Passing a recheck (Pass/Fail above) is what
          completes this step.
        </div>
      )}

      {item.status === "completed" && item.delayCategory && (
        <div className="rounded-lg bg-overlay px-3 py-2 text-xs text-fg-muted">
          {DELAY_CATEGORY_LABELS[item.delayCategory as keyof typeof DELAY_CATEGORY_LABELS]}
        </div>
      )}

      {isDelayedCompletion && !item.delayCategory && (
        <div className="text-xs text-fg-subtle">
          Completed {daysLate} day{daysLate === 1 ? "" : "s"} late
        </div>
      )}

      {item.isDerived && item.derivedSummary && (
        <div className="rounded-lg bg-overlay px-3 py-2 text-xs text-fg-muted">
          Auto-computed from procurement —{" "}
          {item.derivedSummary.map((d) => `${d.itemType}: ${d.done ? "done" : "pending"}`).join(", ")}
        </div>
      )}

      {item.notes && (
        <div className="rounded-lg bg-overlay px-3 py-2 text-xs italic text-fg-muted">
          &ldquo;{item.notes}&rdquo;
        </div>
      )}

      {!item.isDerived && !canStartOrComplete && item.gateBlockedBy && (
        <div className="rounded-lg bg-overlay px-3 py-2 text-xs text-fg-muted">
          Waiting on: {item.gateBlockedBy.join(", ")}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
          {error}
        </div>
      )}

      {panel === "block" && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <select
            className={selectClass}
            value={blockedReason}
            onChange={(e) => setBlockedReason(e.target.value)}
          >
            <option value="">Select a reason…</option>
            {BLOCKED_REASON_OPTIONS.map((reason) => (
              <option key={reason} value={reason}>
                {BLOCKED_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
          <textarea
            className={textareaClass}
            rows={2}
            placeholder={blockedReason === "other" ? "Note (required)" : "Note (optional)"}
            value={blockedNote}
            onChange={(e) => setBlockedNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => setPanel("none")} disabled={submitting}>
              Cancel
            </button>
            <button className={btnPrimary} onClick={confirmBlock} disabled={submitting}>
              {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Confirm block"}
            </button>
          </div>
        </div>
      )}

      {panel === "complete1a" && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <label className="text-xs font-medium text-fg-muted">
            Visit urgency (sets 1B&apos;s schedule)
          </label>
          <select
            className={selectClass}
            value={visitUrgency}
            onChange={(e) => setVisitUrgency(e.target.value)}
          >
            <option value="">Select…</option>
            <option value="emergency">Emergency (2 days)</option>
            <option value="hot">Hot (5 days)</option>
            <option value="cold">Cold (15 days)</option>
            <option value="site_not_ready">Site not ready (blocks 1B)</option>
          </select>
          {needsDelayCategoryChoice && (
            <select
              className={selectClass}
              value={delayCategory}
              onChange={(e) => setDelayCategory(e.target.value)}
            >
              <option value="">Reason for delay…</option>
              {DELAY_CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>
                  {DELAY_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          )}
          <textarea
            className={textareaClass}
            rows={2}
            placeholder={needsLateReason ? "Note required — actual end is after planned finish" : "Note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {needsLateReason && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Add a note before marking a late step complete</p>
          )}
          {needsDelayCategory && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Choose whether the delay was client side or in house
            </p>
          )}
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => setPanel("none")} disabled={submitting}>
              Cancel
            </button>
            <button
              className={btnPrimary}
              onClick={confirmComplete1A}
              disabled={submitting || needsLateReason || needsDelayCategory}
            >
              {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Confirm complete"}
            </button>
          </div>
        </div>
      )}

      {panel === "revert" && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          {!revertPlan && !error && <p className="text-xs text-fg-muted">Checking what this affects…</p>}

          {revertPlan && (
            <>
              <p className="text-xs text-fg-muted">
                Moves this step back to{" "}
                <span className="font-medium text-fg">{STEP_STATUS_LABELS[revertPlan.toStatus]}</span> and clears
                its actual dates so the information can be corrected.
              </p>

              {(revertPlan.procurementReset ||
                revertPlan.projectDataClears.length > 0 ||
                revertPlan.clearsStepNotes) && (
                <div className="flex flex-col gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
                  <div className="font-medium">Data recorded after this step is discarded</div>
                  <ul className="flex list-disc flex-col gap-1 pl-4">
                    {revertPlan.procurementReset && (
                      <li>
                        The {formatStepList(revertPlan.procurementReset.clears)} on all three
                        procurement items
                        {revertPlan.procurementReset.fullReset
                          ? " — section, hardware and gasket go all the way back to empty, notes included"
                          : " — earlier stages are kept"}
                        . {formatStepList(revertPlan.procurementReset.stepCodes)} reset to Not started
                        as a result.
                      </li>
                    )}
                    {revertPlan.projectDataClears.map((label) => (
                      <li key={label}>{label.charAt(0).toUpperCase() + label.slice(1)}</li>
                    ))}
                    {revertPlan.clearsStepNotes && <li>Notes on the steps being reverted</li>}
                  </ul>
                  <div>This can&apos;t be undone.</div>
                  {revertPlan.needsConsent && (
                    <label className="flex items-start gap-2 font-medium text-fg">
                      <input
                        type="checkbox"
                        className="mt-0.5 size-4 shrink-0 accent-red-500"
                        checked={clearProcurement}
                        onChange={(e) => setClearProcurement(e.target.checked)}
                      />
                      Yes, discard that data and revert
                    </label>
                  )}
                </div>
              )}

              {revertPlan.cascade.length > 0 && (
                <div className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
                  <div className="font-medium">
                    {revertPlan.cascade.length} downstream{" "}
                    {revertPlan.cascade.length === 1 ? "step" : "steps"} will reset to Not started
                  </div>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {revertPlan.cascade.map((s) => (
                      <li key={s.stepCode}>
                        <span className="font-mono">{s.stepCode}</span> {s.stepName} (
                        {STEP_STATUS_LABELS[s.status]})
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {revertPlan.phaseChange && (
                <p className="text-xs text-fg-muted">
                  The project moves back from{" "}
                  <span className="font-medium text-fg">{PHASE_LABELS[revertPlan.phaseChange.from as keyof typeof PHASE_LABELS]}</span> to{" "}
                  <span className="font-medium text-fg">{PHASE_LABELS[revertPlan.phaseChange.to as keyof typeof PHASE_LABELS]}</span>. The
                  steps and procurement rows themselves stay — they reset rather than being deleted, so the
                  phase is picked up again from where it starts.
                </p>
              )}

              <textarea
                className={textareaClass}
                rows={2}
                placeholder="Reason (required) — what was wrong"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </>
          )}

          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => setPanel("none")} disabled={submitting}>
              Cancel
            </button>
            {revertPlan && (
              <button
                className={btnPrimary}
                onClick={confirmRevert}
                disabled={submitting || (revertPlan.needsConsent && !clearProcurement)}
              >
                {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Confirm revert"}
              </button>
            )}
          </div>
        </div>
      )}

      {canEditDates && hasManualPlannedDates && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <div className={`grid gap-2 ${plannedDatesEndOnly ? "grid-cols-1" : "grid-cols-2"}`}>
            {!plannedDatesEndOnly && (
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-muted">Planned start</label>
                <input
                  type="date"
                  value={plannedDateFields.plannedStartDate}
                  disabled={plannedDatesLocked}
                  onChange={(e) => setPlannedDateFields((prev) => ({ ...prev, plannedStartDate: e.target.value }))}
                  onClick={openPicker}
                  className={`h-10 w-full rounded-lg border px-2 text-sm outline-none disabled:opacity-80 ${
                    plannedDatesLocked
                      ? "border-edge bg-overlay text-fg-muted"
                      : "border-edge bg-bg text-fg focus:border-accent focus:ring-2 focus:ring-accent/30"
                  }`}
                />
              </div>
            )}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-muted">Planned end</label>
              <input
                type="date"
                value={plannedDateFields.plannedEndDate}
                disabled={plannedDatesLocked}
                onChange={(e) => setPlannedDateFields((prev) => ({ ...prev, plannedEndDate: e.target.value }))}
                onClick={openPicker}
                className={`h-10 w-full rounded-lg border px-2 text-sm outline-none disabled:opacity-80 ${
                  plannedDatesLocked
                    ? "border-edge bg-overlay text-fg-muted"
                    : "border-edge bg-bg text-fg focus:border-accent focus:ring-2 focus:ring-accent/30"
                }`}
              />
            </div>
          </div>
          {plannedDatesLocked ? (
            <p className="text-xs text-fg-subtle">Planned dates are locked in — filled in by hand, not computed.</p>
          ) : (
            <>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={savePlannedDates}
                  disabled={plannedDateSubmitting}
                  className={`${btnAdminSmall} disabled:opacity-40`}
                >
                  {plannedDateSubmitting ? <Spinner className="h-3.5 w-3.5" /> : "Save planned dates"}
                </button>
              </div>
              {plannedDateSaved && <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved</p>}
              {plannedDateError && <p className="text-xs text-red-600 dark:text-red-400">{plannedDateError}</p>}

              <div className="flex flex-col gap-1.5 rounded-lg border border-edge bg-overlay/40 p-2">
                <span className="text-xs font-medium text-fg-muted">
                  Let a department fill these in themselves
                </span>
                <select
                  value={plannedDateEditDeptDraft}
                  onChange={(e) => setPlannedDateEditDeptDraft(e.target.value)}
                  className="h-10 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                >
                  <option value="">No one — admin only</option>
                  {ASSIGNABLE_DEPARTMENTS.map((dept) => (
                    <option key={dept} value={dept}>
                      {DEPARTMENT_LABELS[dept]}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={savePlannedDatePermission}
                    disabled={plannedDatePermissionSubmitting}
                    className={`${btnAdminSmall} disabled:opacity-40`}
                  >
                    {plannedDatePermissionSubmitting ? <Spinner className="h-3.5 w-3.5" /> : "Save permission"}
                  </button>
                </div>
                {plannedDatePermissionSaved && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved</p>
                )}
                {plannedDatePermissionError && (
                  <p className="text-xs text-red-600 dark:text-red-400">{plannedDatePermissionError}</p>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {canEditDates && isInstallationOverride && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <p className="text-xs text-fg-subtle">
            Prefilled from the Installation planned window — a rough default, not a fixed plan. Edit and save to
            override it; Reset goes back to tracking the window automatically.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-muted">Planned start</label>
              <input
                type="date"
                value={plannedDateFields.plannedStartDate}
                disabled={plannedDateSubmitting}
                onChange={(e) => setPlannedDateFields((prev) => ({ ...prev, plannedStartDate: e.target.value }))}
                onClick={openPicker}
                className="h-10 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-80"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-fg-muted">Planned end</label>
              <input
                type="date"
                value={plannedDateFields.plannedEndDate}
                disabled={plannedDateSubmitting}
                onChange={(e) => setPlannedDateFields((prev) => ({ ...prev, plannedEndDate: e.target.value }))}
                onClick={openPicker}
                className="h-10 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-80"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={savePlannedDates}
              disabled={plannedDateSubmitting}
              className={`${btnAdminSmall} disabled:opacity-40`}
            >
              {plannedDateSubmitting ? <Spinner className="h-3.5 w-3.5" /> : "Save planned dates"}
            </button>
            <button
              type="button"
              onClick={resetPlannedDatesToAuto}
              disabled={plannedDateSubmitting}
              className={`${btnSecondary} disabled:opacity-40`}
            >
              Reset to automatic
            </button>
          </div>
          {plannedDateSaved && <p className="text-xs text-emerald-600 dark:text-emerald-400">Saved</p>}
          {plannedDateError && <p className="text-xs text-red-600 dark:text-red-400">{plannedDateError}</p>}
        </div>
      )}

      {canEditDates && isGlassPO && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <div className={`grid gap-2 ${visibleDateFields.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {visibleDateFields.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-muted">{label}</label>
                <input
                  type="date"
                  value={dateFields[key]}
                  disabled
                  readOnly
                  className="h-10 w-full rounded-lg border border-edge bg-overlay px-2 text-sm text-fg-muted outline-none"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-fg-subtle">{GLASS_PO_HINT[item.stepCode]}</p>
        </div>
      )}

      {canEditDates && !item.isDerived && !isGlassPO && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <div className={`grid gap-2 ${visibleDateFields.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}>
            {visibleDateFields.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-muted">{label}</label>
                <input
                  type="date"
                  value={dateFields[key]}
                  onChange={(e) => setDateFields((prev) => ({ ...prev, [key]: e.target.value }))}
                  onClick={openPicker}
                  className="h-10 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </div>
            ))}
          </div>
          {hasStatusAction ? (
            <p className="text-xs text-fg-subtle">Dates are saved together with the button below.</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="Note (optional)"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="h-10 flex-1 rounded-lg border border-edge bg-bg px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
                <button
                  type="button"
                  onClick={saveDates}
                  disabled={dateSubmitting}
                  title="Save dates"
                  aria-label="Save dates"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-2 disabled:opacity-40"
                >
                  {dateSubmitting ? (
                    <Spinner className="h-4 w-4" />
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className="h-4 w-4 stroke-current">
                      <path d="M5 12.5 10 17l9-10" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              </div>
              {dateMessage && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${
                    dateMessage.type === "success"
                      ? "bg-emerald-500/10 text-emerald-600 ring-1 ring-inset ring-emerald-500/25 dark:text-emerald-400"
                      : "bg-red-500/10 text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400"
                  }`}
                >
                  {dateMessage.text}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Derived steps get this too: reverting one clears the procurement data it derives
          from, which the confirmation panel spells out before anything is discarded. Only
          offered once a step is actually completed — there's nothing to revert before then. */}
      {panel === "none" && canRevert && item.status === "completed" && (
        <div className="flex gap-2">
          <button className={btnAdminSmall} onClick={openRevert}>
            Revert
          </button>
        </div>
      )}

      {panel === "none" && hasStatusAction && (
        <>
          {needsDelayCategoryChoice && (
            <select
              className={selectClass}
              value={delayCategory}
              onChange={(e) => setDelayCategory(e.target.value)}
            >
              <option value="">Reason for delay…</option>
              {DELAY_CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>
                  {DELAY_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          )}
          <textarea
            className={textareaClass}
            rows={2}
            placeholder={
              needsLateReason
                ? "Note required — actual end is after planned finish"
                : QC_STEP_CODES.has(item.stepCode) && item.status === "in_progress"
                  ? "Note (required to fail)"
                  : "Note (optional)"
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {needsLateReason && item.stepCode !== "1A" && (
            <p className="text-xs text-amber-600 dark:text-amber-400">Add a note before marking a late step complete</p>
          )}
          {needsDelayCategory && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Choose whether the delay was client side or in house
            </p>
          )}
        </>
      )}

      {panel === "none" && !item.isDerived && !isGlassPO && (
        <div className="flex gap-2">
          {item.status === "not_started" && (
            <>
              {SINGLE_COMPLETION_STEP_CODES.has(item.stepCode) ? (
                <button
                  className={btnPrimary}
                  onClick={completeStep}
                  disabled={
                    submitting ||
                    !canStartOrComplete ||
                    (item.stepCode !== "1A" && (needsLateReason || needsDelayCategory))
                  }
                >
                  {item.stepCode === "2D2" ? "Mark complete" : "Completed"}
                </button>
              ) : (
                <button
                  className={btnPrimary}
                  onClick={startStep}
                  disabled={submitting || !canStartOrComplete || blockedByUnsavedPlannedDates}
                  title={blockedByUnsavedPlannedDates ? plannedDatesHint : undefined}
                >
                  Start
                </button>
              )}
              <button className={btnSecondary} onClick={() => setPanel("block")} disabled={submitting}>
                Report blocked
              </button>
            </>
          )}
          {item.status === "in_progress" && (
            <>
              {QC_STEP_CODES.has(item.stepCode) ? (
                <>
                  <button
                    className={btnPrimary}
                    onClick={() => handleQCOutcome(true)}
                    disabled={
                      submitting ||
                      !canStartOrComplete ||
                      blockedByUnsavedPlannedDates ||
                      needsLateReason ||
                      needsDelayCategory
                    }
                    title={blockedByUnsavedPlannedDates ? plannedDatesHint : undefined}
                  >
                    Pass
                  </button>
                  <button
                    className={btnDanger}
                    onClick={() => handleQCOutcome(false)}
                    disabled={submitting || blockedByUnsavedPlannedDates || !note.trim()}
                    title={
                      blockedByUnsavedPlannedDates
                        ? plannedDatesHint
                        : !note.trim()
                          ? "Add a note explaining the failure first"
                          : undefined
                    }
                  >
                    Fail
                  </button>
                </>
              ) : (
                <button
                  className={btnPrimary}
                  onClick={completeStep}
                  disabled={
                    submitting ||
                    !canStartOrComplete ||
                    blockedByUnsavedPlannedDates ||
                    (item.stepCode !== "1A" && (needsLateReason || needsDelayCategory))
                  }
                  title={blockedByUnsavedPlannedDates ? plannedDatesHint : undefined}
                >
                  Mark complete
                </button>
              )}
              <button className={btnSecondary} onClick={() => setPanel("block")} disabled={submitting}>
                Report blocked
              </button>
            </>
          )}
          {item.status === "blocked" && (
            <button className={btnPrimary} onClick={resumeStep} disabled={submitting}>
              Resume
            </button>
          )}
        </div>
      )}
      {/* hasStatusAction (rather than repeating its isDerived/isGlassPO/completed checks) also
          keeps this from lingering on a step that somehow reached completed with its planned
          dates still unsaved — e.g. legacy data, or a direct API edit that bypassed the button
          gate above — where Start/Mark complete are long gone and there'd be nothing left to
          act on this hint. */}
      {panel === "none" && hasStatusAction && item.status !== "blocked" && blockedByUnsavedPlannedDates && (
        <p className="text-xs text-amber-600 dark:text-amber-400">{plannedDatesHint}</p>
      )}
    </div>
  );
}
