"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

/**
 * Removes a service from the app. The row is kept in the database — this only stamps
 * deleted_at, after which nothing in the front end shows the service again. Mirrors
 * DeleteProjectButton exactly, just repointed at /api/services.
 *
 * Two-step on purpose: the first click swaps in an explicit confirm, so a delete can't happen
 * from one stray click on a row the user was only trying to open.
 */
export function DeleteServiceButton({
  serviceId,
  serviceTitle,
}: {
  serviceId: string;
  serviceTitle: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/services/${serviceId}`, { method: "DELETE" });
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
      <button
        type="button"
        aria-label={`Delete ${serviceTitle}`}
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={deleting}
        className="rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-500/30 transition-colors hover:bg-red-500/25 disabled:opacity-40 dark:text-red-400"
      >
        {deleting ? <Spinner className="h-3.5 w-3.5" /> : "Confirm"}
      </button>
    </span>
  );
}
