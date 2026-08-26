"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MyTaskItem } from "@/lib/my-tasks";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";
import {
  STEP_STATUS_LABELS,
  STEP_STATUS_COLORS,
  BLOCKED_REASON_LABELS,
  BLOCKED_REASON_OPTIONS,
  DELAY_CATEGORY_LABELS,
  DELAY_CATEGORY_OPTIONS,
  DEPARTMENT_LABELS,
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
// or because only its completion date is worth tracking (2D2). Either way, only the completion
// date is meaningful to show here.
const SINGLE_DATE_FIELD_STEP_CODES = new Set(["1A", "1B", "1C", "1D", "2A", "2D2"]);

// Steps that skip the Start->Mark complete two-click flow at not_started and jump straight to
// a single completion button. Includes 1A/1B plus 1D, which — like 1B and 1C —
// auto-starts the moment its dependency completes (see autoStartStep in step-actions.ts), so a
// project moving through the normal flow never actually sees it sit at not_started. This only
// matters for legacy data that reached 1D before that auto-start existed, where it's still
// stuck at not_started: even there it should offer one click, not two.
const SINGLE_COMPLETION_STEP_CODES = new Set(["1A", "1B", "1D"]);

// Steps whose late completion asks for a client-side/in-house delay reason. Kept local rather
// than imported — step-actions.ts (which owns the server-side copy of this same set, as
// DELAY_CATEGORY_STEP_CODES) pulls in the Prisma client, which a "use client" file can't import
// — so this must be kept in sync with that set by hand.
const DELAY_CATEGORY_STEP_CODES = new Set(["1A", "1B", "1C", "1D", "2D2"]);

const btnPrimary =
  "flex-1 flex h-11 items-center justify-center rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-40";
const btnSecondary =
  "flex-1 flex h-11 items-center justify-center rounded-lg border border-edge px-3 text-sm font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg disabled:opacity-40";
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
  const visibleDateFields = SINGLE_DATE_FIELD_STEP_CODES.has(item.stepCode)
    ? DATE_FIELDS.filter((f) => f.key !== "actualStartDate")
    : DATE_FIELDS;
  // When there's a status button coming up below (Start/Mark complete/Resume), date edits
  // ride along with that single click instead of needing their own separate save — see
  // submitWithDates. Only steps with no such button (completed, derived) keep the standalone
  // save-dates control, since nothing else would ever submit their date edits.
  const hasStatusAction = !item.isDerived && item.status !== "completed";
  // Same condition as the "Overdue" pill below — blocked steps already get their own red
  // treatment via the blocked-reason banner, so this doesn't pile an amber highlight on top.
  const isOverdueCard = item.overrun && item.status !== "blocked";
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
          <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${STATUS_ICON_WRAP[item.status]}`}>
            <StatusIcon status={item.status} className="h-5 w-5 stroke-current" />
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
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STEP_STATUS_COLORS[item.status]}`}>
            {STEP_STATUS_LABELS[item.status]}
          </span>
          {item.overrun && item.status !== "blocked" && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              Overdue
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
        </div>
      </div>

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
              {submitting ? "Saving…" : "Confirm block"}
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
              {submitting ? "Saving…" : "Confirm complete"}
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
                {submitting ? "Reverting…" : "Confirm revert"}
              </button>
            )}
          </div>
        </div>
      )}

      {canEditDates && !item.isDerived && (
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
                    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className="h-4 w-4 animate-spin stroke-current">
                      <circle cx="12" cy="12" r="8.5" strokeDasharray="30 100" strokeLinecap="round" />
                    </svg>
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
            placeholder={needsLateReason ? "Note required — actual end is after planned finish" : "Note (optional)"}
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

      {panel === "none" && !item.isDerived && (
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
                  Completed
                </button>
              ) : (
                <button className={btnPrimary} onClick={startStep} disabled={submitting || !canStartOrComplete}>
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
              <button
                className={btnPrimary}
                onClick={completeStep}
                disabled={
                  submitting ||
                  !canStartOrComplete ||
                  (item.stepCode !== "1A" && (needsLateReason || needsDelayCategory))
                }
              >
                Mark complete
              </button>
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
    </div>
  );
}
