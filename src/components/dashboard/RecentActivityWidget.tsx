"use client";

import { useState } from "react";
import Link from "next/link";
import type { RecentActivityRow } from "@/lib/dashboard";
import { DEPARTMENT_LABELS, STEP_STATUS_LABELS } from "@/lib/labels";
import type { StepStatus } from "@prisma/client";

const STATUS_DOT: Record<StepStatus, string> = {
  not_started: "bg-white/20",
  in_progress: "bg-blue-500",
  blocked: "bg-red-500",
  completed: "bg-emerald-500",
};

function formatRelativeTime(date: Date): string {
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

function ActivityRow({ row }: { row: RecentActivityRow }) {
  return (
    <li>
      <Link
        href={`/projects/${row.projectId}`}
        className="-mx-1 flex items-start gap-3 rounded-lg p-1.5 hover:bg-white/[0.04]"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[row.newStatus]}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-fg-muted">
            <span className="font-medium text-fg">{row.changedByName}</span> marked{" "}
            <span className="font-medium text-fg">{row.stepName}</span> as {STEP_STATUS_LABELS[row.newStatus]}
          </p>
          <p className="truncate text-xs text-fg-subtle">
            {row.projectName} · {DEPARTMENT_LABELS[row.department]} · {formatRelativeTime(row.changedAt)}
          </p>
          {row.reason && <p className="mt-0.5 truncate text-xs italic text-fg-subtle">{row.reason}</p>}
        </div>
      </Link>
    </li>
  );
}

export function RecentActivityWidget({
  initialData,
  initialCursor,
}: {
  initialData: RecentActivityRow[];
  initialCursor: string | null;
}) {
  const [rows, setRows] = useState(initialData);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/recent-activity?cursor=${encodeURIComponent(cursor)}`);
      if (!res.ok) throw new Error("Failed to load more activity");
      const page: { rows: (Omit<RecentActivityRow, "changedAt"> & { changedAt: string })[]; nextCursor: string | null } =
        await res.json();
      setRows((prev) => [...prev, ...page.rows.map((r) => ({ ...r, changedAt: new Date(r.changedAt) }))]);
      setCursor(page.nextCursor);
    } catch {
      setError("Couldn't load more activity. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-xl border border-edge bg-surface p-4 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold text-fg">Recent activity</h3>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-fg-muted">No activity yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <ActivityRow key={row.id} row={row} />
            ))}
          </ul>

          {error && <p className="mt-3 text-center text-xs text-red-400">{error}</p>}

          {cursor && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="rounded-lg border border-edge px-4 py-2 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-white/[0.04] hover:text-fg disabled:opacity-50"
              >
                {loading ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
