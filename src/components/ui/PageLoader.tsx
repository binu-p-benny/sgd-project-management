import { Spinner } from "./Spinner";

/**
 * Full-section loading state for a route segment — rendered automatically by Next.js
 * as the Suspense fallback while a page.tsx (or its layout) is doing async work, via
 * the sibling loading.tsx files under src/app/**. Sized to roughly fill the content
 * area under AppShell's header so it doesn't collapse to a sliver on a near-empty page.
 */
export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] w-full flex-col items-center justify-center gap-3 text-fg-muted">
      <Spinner className="h-8 w-8 text-accent" />
      <p className="text-sm">{label}</p>
    </div>
  );
}
