"use client";

import { useEffect } from "react";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] unhandled render error", error);
  }, [error]);

  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h2 className="text-base font-semibold text-fg">Something went wrong</h2>
      <p className="max-w-md text-sm text-fg-muted">
        We hit an unexpected error loading this page. This is usually temporary — try again in a moment.
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
