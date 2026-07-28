"use client";

import { useState } from "react";
import Link from "next/link";
import type { RecentActivityRow } from "@/lib/dashboard";
import { DEPARTMENT_LABELS, STEP_STATUS_LABELS } from "@/lib/labels";
import type { StepStatus } from "@prisma/client";

const STATUS_DOT: Record<StepStatus, string> = {
  not_started: "bg-zinc-300 dark:bg-zinc-600",
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
        className="-mx-1 flex items-start gap-3 rounded-lg p-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60"
      >
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[row.newStatus]}`} />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.changedByName}</span> marked{" "}
            <span className="font-medium text-zinc-900 dark:text-zinc-50">{row.stepName}</span> as{" "}
            {STEP_STATUS_LABELS[row.newStatus]}
          </p>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
            {row.projectName} · {DEPARTMENT_LABELS[row.department]} · {formatRelativeTime(row.changedAt)}
          </p>
          {row.reason && (
            <p className="mt-0.5 truncate text-xs italic text-zinc-400 dark:text-zinc-500">{row.reason}</p>
          )}
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
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Recent activity</h3>

      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-400">No activity yet.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1">
            {rows.map((row) => (
              <ActivityRow key={row.id} row={row} />
            ))}
          </ul>

          {error && <p className="mt-3 text-center text-xs text-red-600 dark:text-red-400">{error}</p>}

          {cursor && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                className="rounded-lg border border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
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
