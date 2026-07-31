"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard] render error", error);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-edge bg-surface p-8 text-center">
      <h2 className="text-base font-semibold text-fg">Couldn&apos;t load the dashboard</h2>
      <p className="max-w-md text-sm text-fg-muted">
        Something went wrong while fetching dashboard data. This is usually temporary — try again in a moment.
      </p>
      <button
        onClick={() => reset()}
        className="mt-1 rounded-lg border border-edge bg-surface-2 px-4 py-2 text-sm font-medium text-fg transition-colors hover:border-edge-2 hover:bg-surface"
      >
        Try again
      </button>
    </div>
  );
}
