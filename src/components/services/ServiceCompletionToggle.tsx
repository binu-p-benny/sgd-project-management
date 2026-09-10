"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * The only way a service becomes (or stops being) "completed" — see getServiceStatus in
 * lib/service.ts, which never infers completion from item rows. Sits in the services list's
 * Actions column next to Delete, same admin-only gate as that button.
 */
export function ServiceCompletionToggle({
  serviceId,
  completed,
}: {
  serviceId: string;
  completed: boolean;
}) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleChange(next: boolean) {
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ completed: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Update failed");
        setUpdating(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setUpdating(false);
    }
  }

  if (error) {
    return (
      <span className="text-xs text-red-600 dark:text-red-400" title={error}>
        {error}
      </span>
    );
  }

  return (
    <select
      aria-label="Service completion"
      value={completed ? "completed" : "open"}
      disabled={updating}
      onChange={(e) => handleChange(e.target.value === "completed")}
      className="h-8 rounded-lg border border-edge bg-bg px-2 text-xs font-medium text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
    >
      <option value="open">Not completed</option>
      <option value="completed">Completed</option>
    </select>
  );
}
