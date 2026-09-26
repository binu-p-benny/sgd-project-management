"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { isProcurementStageOverrun } from "@/lib/overrun";
import type { DepartmentFollowUp } from "@/lib/follow-ups";

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/**
 * The "Follow-ups" control in /my-tasks' own header and the panel behind it — everything this
 * department is chasing, in one place, across every project.
 *
 * The open ones are already in the task table below (a follow-up is a task like any other), but
 * they are scattered through it by due date; this is the "what am I chasing, and what did I just
 * close" read. Recently closed ones are listed too, which the table by design never shows.
 */
export function FollowUpsDrawer({ followUps, isAdmin }: { followUps: DepartmentFollowUp[]; isAdmin: boolean }) {
  const [open, setOpen] = useState(false);
  const openItems = followUps.filter((f) => !f.actualDate);

  // Escape closes it, and the page behind it stops scrolling while it's up.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const overdueCount = openItems.filter((f) => isProcurementStageOverrun(new Date(f.plannedDate), null)).length;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-edge bg-surface px-3 text-sm font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg"
      >
        <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-4 w-4 stroke-current">
          <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
          <path d="M16.5 16.5 19 19l3.5-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Follow-ups
        <span
          className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${
            openItems.length > 0
              ? "bg-amber-500/15 text-amber-700 ring-1 ring-inset ring-amber-500/30 dark:text-amber-400"
              : "bg-overlay-2 text-fg-subtle"
          }`}
        >
          {openItems.length}
        </span>
      </button>

      {open && (
        <FollowUpsPanel
          followUps={followUps}
          openCount={openItems.length}
          overdueCount={overdueCount}
          isAdmin={isAdmin}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function FollowUpsPanel({
  followUps,
  openCount,
  overdueCount,
  isAdmin,
  onClose,
}: {
  followUps: DepartmentFollowUp[];
  openCount: number;
  overdueCount: number;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggleDone(id: string, done: boolean) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/follow-ups/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualDate: done ? null : new Date().toISOString() }),
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

  const openItems = followUps.filter((f) => !f.actualDate);
  const doneItems = followUps.filter((f) => f.actualDate);

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      {/* Slides in from the right; the width caps so it reads as a panel on a desktop and takes
          the whole screen on a phone. */}
      <div
        className="flex h-full w-full max-w-md flex-col border-l border-edge bg-surface shadow-[var(--shadow-lg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-edge px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-fg">Follow-ups</h2>
            <p className="mt-0.5 text-xs text-fg-muted">
              {openCount} open
              {overdueCount > 0 && <span className="text-amber-700 dark:text-amber-400"> · {overdueCount} overdue</span>}
              {doneItems.length > 0 && ` · ${doneItems.length} closed recently`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-overlay hover:text-fg"
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-4 w-4 stroke-current">
              <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {error && (
          <p className="mx-4 mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-700 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          {followUps.length === 0 ? (
            <p className="rounded-lg border border-dashed border-edge-2 py-10 text-center text-sm text-fg-muted">
              Nothing to follow up on.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {openItems.length > 0 && (
                <FollowUpList
                  items={openItems}
                  busyId={busyId}
                  isAdmin={isAdmin}
                  onToggle={(id) => toggleDone(id, false)}
                />
              )}
              {doneItems.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                    Closed in the last 30 days
                  </h3>
                  <FollowUpList items={doneItems} busyId={busyId} isAdmin={isAdmin} onToggle={(id) => toggleDone(id, true)} />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function FollowUpList({
  items,
  busyId,
  isAdmin,
  onToggle,
}: {
  items: DepartmentFollowUp[];
  busyId: string | null;
  isAdmin: boolean;
  onToggle: (id: string) => void;
}) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((f) => {
        const done = !!f.actualDate;
        const overdue = !done && isProcurementStageOverrun(new Date(f.plannedDate), null);
        return (
          <li
            key={f.id}
            className={`flex flex-col gap-1.5 rounded-lg border border-edge p-3 ${done ? "bg-overlay/60" : "bg-bg"}`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className={`text-sm ${done ? "text-fg-muted line-through" : "text-fg"}`}>{f.taskLabel}</span>
              <div className="flex shrink-0 items-center gap-2">
                {busyId === f.id && <Spinner className="h-3.5 w-3.5" />}
                <button
                  type="button"
                  disabled={busyId === f.id}
                  onClick={() => onToggle(f.id)}
                  className="text-[11px] font-medium text-accent hover:underline disabled:opacity-50"
                >
                  {done ? "Reopen" : "Mark done"}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-fg-subtle">
              {/* Only admins can open a project page — everyone else gets the name as plain text
                  rather than a link that would bounce them straight back here. */}
              {isAdmin ? (
                <Link href={`/projects/${f.projectId}`} className="font-medium text-fg-muted hover:text-accent hover:underline">
                  {f.projectName}
                </Link>
              ) : (
                <span className="font-medium text-fg-muted">{f.projectName}</span>
              )}
              <span>·</span>
              <span>{f.anchorLabel}</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              {done ? (
                <span className="text-emerald-600 dark:text-emerald-400">Done {formatDate(f.actualDate!)}</span>
              ) : (
                <span className={overdue ? "font-medium text-amber-700 dark:text-amber-400" : "text-fg-muted"}>
                  {overdue ? "Was due" : "Due"} {formatDate(f.plannedDate)}
                </span>
              )}
              {f.createdByName && <span className="text-fg-subtle">· raised by {f.createdByName}</span>}
            </div>

            {f.note && <p className="text-xs text-fg-muted">{f.note}</p>}
          </li>
        );
      })}
    </ul>
  );
}
