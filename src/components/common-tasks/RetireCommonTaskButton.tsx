"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Soft-deletes a common task — same two-step confirm as DeleteContractorButton, just "retire"
 * rather than "delete" in the wording: the row (and its completion history) stays in the
 * database, it just stops being raised in anyone's /my-tasks (see DELETE /api/common-tasks/[id]).
 */
export function RetireCommonTaskButton({ taskId, taskLabel }: { taskId: string; taskLabel: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [retiring, setRetiring] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retire() {
    setRetiring(true);
    setError(null);
    try {
      const res = await fetch(`/api/common-tasks/${taskId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Could not retire");
        setRetiring(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setRetiring(false);
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
      <button
        type="button"
        aria-label={`Retire ${taskLabel}`}
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
      >
        Retire
      </button>
    );
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={retiring}
        className="rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={retire}
        disabled={retiring}
        className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-500/30 transition-colors hover:bg-red-500/25 disabled:opacity-40 dark:text-red-400"
      >
        {retiring ? <Spinner className="h-3.5 w-3.5" /> : "Confirm"}
      </button>
    </span>
  );
}
