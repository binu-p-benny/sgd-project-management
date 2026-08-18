"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";

// Matches the chart-series-1/2/3 mapping used for these item types elsewhere on the dashboard.
const ITEM_TYPE_WRAP: Record<string, string> = {
  section:
    "bg-indigo-50 text-indigo-700 ring-1 ring-inset ring-indigo-200 dark:bg-indigo-500/10 dark:text-indigo-400 dark:ring-indigo-500/25",
  hardware:
    "bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/25",
  gasket:
    "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25",
};

function ItemTypeIcon({ itemType, className }: { itemType: string; className?: string }) {
  const common = { viewBox: "0 0 24 24", fill: "none", strokeWidth: 1.8, className };
  if (itemType === "hardware") {
    return (
      <svg {...common}>
        <path
          d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.6L4 17v3h3l5.9-5.9a3.5 3.5 0 0 0 4.6-4.6l-2.3 2.3-2-2 2.3-2.3Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (itemType === "gasket") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="8" />
        <circle cx="12" cy="12" r="3.5" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z" strokeLinejoin="round" />
    </svg>
  );
}

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

interface StageData {
  id: string;
  label: string;
  dateField: string;
  noteField: string;
  plannedDate: string | null;
  actualDate: string | null;
  note: string | null;
  overrun: boolean;
  /** Design Engineer (2A's owner) can edit this row even without full Purchase access. */
  requirementGated: boolean;
  /** Only meaningful for the "qc" row: null = no result yet, true = passed, false = failed. */
  qcPassed: boolean | null;
}

interface ProcurementItemData {
  id: string;
  itemType: string;
  stages: StageData[];
  /** Set once this item has been restarted after a QC failure — its own planned-date anchor
   *  instead of the project's default. */
  planAnchorOverride: string | null;
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

function StageRow({
  itemId,
  stage,
  editable,
  onSaved,
}: {
  itemId: string;
  stage: StageData;
  editable: boolean;
  onSaved: () => void;
}) {
  const isDone = stage.actualDate !== null;
  // useSyncedDraft resyncs these when a sibling row's save triggers router.refresh() and this
  // row's own server data changes underneath it — a plain useState would only ever seed from
  // the very first render.
  const [dateDraft, setDateDraft] = useSyncedDraft(stage.actualDate, toDateInputValue);
  const [noteDraft, setNoteDraft] = useSyncedDraft(stage.note, (v) => v ?? "");
  const [saving, setSaving] = useState<"date" | "note" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Editing an already-done row's date to a *different*, non-empty value is a correction, not
  // a live edit — it un-does the "Done" badge and brings back the completion button(s), same
  // as a not-yet-done row, and always needs a reason regardless of lateness (a correction to a
  // settled record should always be explained). Clearing the field back to empty is treated
  // separately, as an immediate revert — see handleDateInputChange.
  const isCorrection = isDone && dateDraft !== "" && dateDraft !== toDateInputValue(stage.actualDate);
  const showsCompletionAction = !isDone || isCorrection;

  // What actually gets saved if "Mark complete" is clicked right now — the chosen date, or
  // today if none was picked (see handleMarkComplete). Comparing against that, rather than
  // just today's date, is what lets a deliberately-backdated late entry still require a
  // reason even though the field wasn't left empty.
  const effectiveActualDate = dateDraft || toDateInputValue(new Date().toISOString());
  const plannedDateValue = toDateInputValue(stage.plannedDate);
  const isLate = plannedDateValue !== "" && effectiveActualDate > plannedDateValue;
  const needsReason = (isCorrection || isLate) && !noteDraft.trim();
  const isQC = stage.id === "qc";
  // A QC failure always needs a note explaining it, whether or not the date itself is late —
  // a stricter, unconditional version of needsReason that applies only to the Fail action.
  const failNeedsNote = isQC && !noteDraft.trim();

  async function patch(body: Record<string, unknown>, field: "date" | "note") {
    setSaving(field);
    setError(null);
    try {
      const res = await fetch(`/api/procurement-items/${itemId}`, {
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

  // Bundles the note into every completion/correction submit rather than relying on a prior
  // blur having already saved it — needed now that a note can be mandatory (a correction, or
  // a QC fail) right at the moment this button is clicked.
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
      {
        [stage.dateField]: new Date(value).toISOString(),
        qcPassed: passed,
        [stage.noteField]: noteDraft.trim() || null,
      },
      "date"
    );
  }

  function handleDateInputChange(value: string) {
    setDateDraft(value);
    // Clearing an already-done row's date is treated as an immediate revert — no confirm step,
    // no reason needed, same as "undo" anywhere else in this app. Changing it to a *different*
    // date instead is a correction: it just updates the draft here: isCorrection then brings
    // back the completion button(s), which is what actually submits it (see handleMarkComplete/
    // handleQCOutcome), with a reason required first.
    if (isDone && !value) {
      patch({ [stage.dateField]: null }, "date");
    }
  }

  function handleNoteBlur() {
    if (noteDraft !== (stage.note ?? "")) {
      patch({ [stage.noteField]: noteDraft || null }, "note");
    }
  }

  // Some browsers only open the native calendar when the small icon is clicked, not the
  // rest of the field — showPicker() makes the whole input open it on any click.
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

  return (
    <tr className="border-t border-edge">
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
        </div>
      </td>

      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={toDateInputValue(stage.plannedDate)}
            disabled
            title="Planned — system-computed, not editable"
            className="h-9 w-[9.5rem] rounded-lg border border-edge bg-overlay px-2 text-sm text-fg-muted opacity-80"
          />
          {!isDone && stage.overrun && (
            <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              Overdue
            </span>
          )}
        </div>
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
                  : needsReason
                    ? "Reason required — this date is after planned"
                    : "Reason (if delayed) or note"
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
                disabled={saving === "date" || needsReason}
                title={needsReason ? "Add a reason before submitting" : undefined}
                className="flex h-9 items-center justify-center rounded-lg bg-emerald-600 px-3 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {saving === "date" ? "Saving…" : "Pass"}
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
              {saving === "date" ? "Saving…" : "Mark complete"}
            </button>
            {needsReason && <span className="text-[11px] text-amber-600 dark:text-amber-400">Add a reason first</span>}
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

function ItemTable({
  item,
  canEdit,
  canEditRequirement,
}: {
  item: ProcurementItemData;
  canEdit: boolean;
  canEditRequirement: boolean;
}) {
  const router = useRouter();
  const [confirmingRestart, setConfirmingRestart] = useState(false);
  const [restartAnchorDraft, setRestartAnchorDraft] = useState("");
  const [restarting, setRestarting] = useState(false);
  const [restartError, setRestartError] = useState<string | null>(null);

  function openRestartConfirm() {
    setConfirmingRestart(true);
    setRestartAnchorDraft("");
    setRestartError(null);
  }

  async function confirmRestart() {
    if (!restartAnchorDraft) {
      setRestartError("Choose the new planned date for this item first");
      return;
    }
    setRestarting(true);
    setRestartError(null);
    try {
      const res = await fetch(`/api/procurement-items/${item.id}/restart`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planAnchor: new Date(restartAnchorDraft).toISOString() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setRestartError(typeof data.error === "string" ? data.error : "Restart failed");
        setRestarting(false);
        return;
      }
      setConfirmingRestart(false);
      router.refresh();
      setRestarting(false);
    } catch {
      setRestartError("Could not reach the server");
      setRestarting(false);
    }
  }

  const doneCount = item.stages.filter((s) => s.actualDate !== null).length;
  const qcStage = item.stages.find((s) => s.id === "qc");
  const canRestart = canEdit && qcStage?.qcPassed === false;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${ITEM_TYPE_WRAP[item.itemType] ?? "bg-overlay text-fg-muted"}`}
          >
            <ItemTypeIcon itemType={item.itemType} className="h-5 w-5 stroke-current" />
          </span>
          <span className="font-medium capitalize text-fg">{item.itemType}</span>
          {item.planAnchorOverride && (
            <span
              className="rounded-full bg-overlay px-2 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-edge"
              title="This item was restarted after a QC failure and now plans off its own date instead of the project default"
            >
              Restarted · planned from {formatDate(item.planAnchorOverride)}
            </span>
          )}
        </div>
        <span className="text-xs font-medium text-fg-subtle">{doneCount} / 6 done</span>
      </div>

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
            {item.stages.map((stage) => (
              <StageRow
                key={stage.id}
                itemId={item.id}
                stage={stage}
                editable={stage.requirementGated ? canEdit || canEditRequirement : canEdit}
                onSaved={() => router.refresh()}
              />
            ))}
          </tbody>
        </table>
      </div>

      {canRestart && (
        <div className="rounded-lg border border-red-200 bg-red-500/5 p-3 dark:border-red-500/25">
          {!confirmingRestart ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-red-700 dark:text-red-400">
                QC failed for this item — restart it from Requirement created to redo the whole process.
              </p>
              <button
                type="button"
                onClick={openRestartConfirm}
                className="shrink-0 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
              >
                Restart from Requirement created
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-red-700 dark:text-red-400">
                This clears Requirement, Quote, Payment, Order, Arrival and QC data for this item so
                it can be filled in again from scratch. This can&apos;t be undone.
              </p>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-red-700 dark:text-red-400">
                  New planned date for this item (replaces the project default going forward)
                </label>
                <input
                  type="date"
                  value={restartAnchorDraft}
                  disabled={restarting}
                  onChange={(e) => setRestartAnchorDraft(e.target.value)}
                  className="h-9 w-[9.5rem] rounded-lg border border-red-300 bg-bg px-2 text-sm text-fg outline-none focus:border-red-500 focus:ring-2 focus:ring-red-400/30 disabled:opacity-50 dark:border-red-500/40"
                />
              </div>
              {restartError && <p className="text-xs text-red-700 dark:text-red-400">{restartError}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmingRestart(false)}
                  disabled={restarting}
                  className="flex-1 rounded-lg border border-edge px-3 py-1.5 text-xs font-medium text-fg-muted transition-colors hover:bg-overlay disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmRestart}
                  disabled={restarting || !restartAnchorDraft}
                  className="flex-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-40"
                >
                  {restarting ? "Restarting…" : "Confirm restart"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  );
}

export function ProcurementTracker({
  items,
  canEdit,
  canEditRequirement,
}: {
  items: ProcurementItemData[];
  canEdit: boolean;
  /** Design Engineer (2A's owner) can edit the "Requirement created" row even without full Purchase access. */
  canEditRequirement: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-fg">Procurement</h2>
      <div className="flex flex-col gap-4">
        {items.map((item) => (
          <ItemTable key={item.id} item={item} canEdit={canEdit} canEditRequirement={canEditRequirement} />
        ))}
      </div>
    </div>
  );
}
