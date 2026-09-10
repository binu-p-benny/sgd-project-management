"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

// Same stroke conventions as the tracker components' own icons (see ProcurementTracker.tsx) —
// icon-only so the table's Actions column stays as narrow as possible, leaving the other
// columns the width.
function TrashIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className={className}>
      <path
        d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m-9 0 1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

function XIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className={className}>
      <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" strokeLinecap="round" />
    </svg>
  );
}

// Both states below render inside a fixed-width box of the same size — 1 button, right-aligned,
// takes up exactly as much horizontal room as 2 buttons + gap would. Without this, the Actions
// column (sized to its widest actual content, same as any table column) would visibly widen the
// moment one row swaps its single icon for the 2-button confirm, shoving every other column left
// out from under the user's mouse — reserving the wider state's width up front avoids that.
const ACTIONS_WIDTH = "w-16";

/**
 * Removes a project from the app. The row is kept in the database — this only stamps
 * deleted_at, after which nothing in the front end shows the project again.
 *
 * Two-step on purpose: the first click swaps in an explicit confirm, so a delete can't happen
 * from one stray click on a row the user was only trying to open. Icon-only (not text) so the
 * table's Actions column — including the 2-button confirm state — stays as narrow as possible.
 */
export function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Delete failed");
        setDeleting(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <span className="text-xs text-red-600 dark:text-red-400" title={error}>
        {error}
      </span>
    );
  }

  if (!confirming) {
    return (
      <span className={`flex ${ACTIONS_WIDTH} shrink-0 items-center justify-end`}>
        <button
          type="button"
          aria-label={`Delete ${projectName}`}
          title="Delete"
          onClick={() => setConfirming(true)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge text-fg-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
        >
          <TrashIcon className="h-3.5 w-3.5 stroke-current" />
        </button>
      </span>
    );
  }

  return (
    <span className={`flex ${ACTIONS_WIDTH} shrink-0 items-center justify-end gap-1`}>
      <button
        type="button"
        aria-label="Cancel delete"
        title="Cancel"
        onClick={() => setConfirming(false)}
        disabled={deleting}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-edge text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
      >
        <XIcon className="h-3.5 w-3.5 stroke-current" />
      </button>
      <button
        type="button"
        aria-label={`Confirm delete ${projectName}`}
        title={deleting ? "Removing…" : "Confirm delete"}
        onClick={remove}
        disabled={deleting}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-500/15 text-red-600 ring-1 ring-inset ring-red-500/30 transition-colors hover:bg-red-500/25 disabled:opacity-40 dark:text-red-400"
      >
        {deleting ? <Spinner className="h-3.5 w-3.5" /> : <CheckIcon className="h-3.5 w-3.5 stroke-current" />}
      </button>
    </span>
  );
}
