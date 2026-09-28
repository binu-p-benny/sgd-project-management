"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { ASSIGNABLE_DEPARTMENTS, DEPARTMENT_LABELS } from "@/lib/labels";
import type { FollowUpAnchor, FollowUpRow } from "@/lib/follow-ups";
import type { Department } from "@prisma/client";

const fieldCls =
  "h-9 w-full min-w-0 rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

function todayInput(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/**
 * The "Follow ups" control that sits on every card and tracker table on the project detail page,
 * carrying the count of follow-ups raised against that card. Opening it lists what is already
 * there and adds another — each one is stored against this exact card (see FollowUpTask), so a
 * follow-up always says what it came from, here and in the assigned department's /my-tasks.
 *
 * The badge counts what is still open rather than everything ever raised: a card with three
 * finished follow-ups is not a card that needs attention.
 */
export function FollowUpsButton({
  projectId,
  anchor,
  followUps,
  stages,
  canEdit,
  className = "",
}: {
  projectId: string;
  anchor: FollowUpAnchor;
  followUps: FollowUpRow[];
  /** The rows of this card's table, for the sub-task picker. Omitted for a card that has none
   *  — a phase step is a single thing, so its follow-ups are simply about the step. */
  stages?: string[];
  /** Admin editors raise and close follow-ups here; everyone else gets a read-only list. */
  canEdit: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const openCount = followUps.filter((f) => !f.actualDate).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`Follow-ups on ${anchor.label}`}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-edge px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg ${className}`}
      >
        Follow ups
        <span
          className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold tabular-nums ${
            openCount > 0
              ? "bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400"
              : "bg-overlay-2 text-fg-subtle"
          }`}
        >
          {followUps.length}
        </span>
      </button>

      {open && (
        <FollowUpsModal
          projectId={projectId}
          anchor={anchor}
          followUps={followUps}
          stages={stages}
          canEdit={canEdit}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FollowUpsModal({
  projectId,
  anchor,
  followUps,
  stages,
  canEdit,
  onClose,
}: {
  projectId: string;
  anchor: FollowUpAnchor;
  followUps: FollowUpRow[];
  stages?: string[];
  canEdit: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [taskLabel, setTaskLabel] = useState("");
  const [department, setDepartment] = useState<Department>("project_engineer");
  const [plannedDate, setPlannedDate] = useState(todayInput());
  const [note, setNote] = useState("");
  // "" means the card as a whole, which is also what a card without a table always sends.
  const [stageLabel, setStageLabel] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    if (!taskLabel.trim()) {
      setError("Give the follow-up a name");
      return;
    }
    if (!plannedDate) {
      setError("Pick a planned date");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/follow-ups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskLabel: taskLabel.trim(),
          department,
          plannedDate: new Date(plannedDate).toISOString(),
          note: note.trim() || undefined,
          stageLabel: stageLabel || undefined,
          anchorKind: anchor.kind,
          anchorId: anchor.id,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not add the follow-up");
        return;
      }
      setTaskLabel("");
      setNote("");
      setStageLabel("");
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function patch(id: string, data: Record<string, unknown>) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/follow-ups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not update the follow-up");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/follow-ups/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not delete the follow-up");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-xl border border-edge bg-surface p-5 shadow-[var(--shadow-sm)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="text-base font-semibold text-fg">Follow ups</h3>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
              {anchor.label}
            </span>
          </div>
          <p className="text-xs text-fg-muted">
            Anything that needs chasing on this one — it stays tied to this card and reaches the
            department you assign it to in their My Tasks.
          </p>
        </div>

        {error && (
          <p className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex flex-col gap-2 overflow-auto">
          {followUps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-edge-2 py-6 text-center text-xs text-fg-muted">
              No follow-ups on this one yet.
            </p>
          ) : (
            followUps.map((f) => {
              const done = !!f.actualDate;
              return (
                <div
                  key={f.id}
                  className={`flex flex-col gap-1 rounded-lg border border-edge p-2.5 ${done ? "bg-overlay/60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className={`text-sm ${done ? "text-fg-muted line-through" : "text-fg"}`}>
                        {f.taskLabel}
                      </span>
                      {f.stageLabel && (
                        <span className="ml-2 rounded-full bg-overlay px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-edge">
                          {f.stageLabel}
                        </span>
                      )}
                    </span>
                    {canEdit && (
                      <div className="flex shrink-0 items-center gap-2">
                        {busyId === f.id && <Spinner className="h-3.5 w-3.5" />}
                        <button
                          type="button"
                          disabled={busyId === f.id}
                          onClick={() => patch(f.id, { actualDate: done ? null : new Date().toISOString() })}
                          className="text-[11px] font-medium text-accent hover:underline disabled:opacity-50"
                        >
                          {done ? "Reopen" : "Mark done"}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === f.id}
                          onClick={() => remove(f.id)}
                          className="text-[11px] font-medium text-red-600 hover:underline disabled:opacity-50 dark:text-red-400"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-subtle">
                    <span>{DEPARTMENT_LABELS[f.department]}</span>
                    <span>Planned {formatDate(f.plannedDate)}</span>
                    {done && <span className="text-emerald-600 dark:text-emerald-400">Done {formatDate(f.actualDate!)}</span>}
                    {f.createdByName && <span>Raised by {f.createdByName}</span>}
                  </div>
                  {f.note && <p className="text-xs text-fg-muted">{f.note}</p>}
                </div>
              );
            })
          )}
        </div>

        {canEdit && (
          <div className="flex flex-col gap-2 border-t border-edge pt-3">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_9rem_9rem]">
              <input
                className={fieldCls}
                placeholder="What needs following up?"
                value={taskLabel}
                disabled={saving}
                onChange={(e) => setTaskLabel(e.target.value)}
              />
              <select
                className={fieldCls}
                value={department}
                disabled={saving}
                onChange={(e) => setDepartment(e.target.value as Department)}
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
                value={plannedDate}
                disabled={saving}
                onChange={(e) => setPlannedDate(e.target.value)}
              />
            </div>
            {stages && stages.length > 0 && (
              <select
                className={fieldCls}
                value={stageLabel}
                disabled={saving}
                onChange={(e) => setStageLabel(e.target.value)}
              >
                <option value="">Whole card (no particular row)</option>
                {stages.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage}
                  </option>
                ))}
              </select>
            )}
            <input
              className={fieldCls}
              placeholder="Note (optional)"
              value={note}
              disabled={saving}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-edge pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:bg-overlay hover:text-fg"
          >
            Close
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={add}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-60"
            >
              {saving && <Spinner className="h-3.5 w-3.5" />}
              Add follow up
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
