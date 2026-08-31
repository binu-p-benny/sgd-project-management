/**
 * Shared spinning-circle indicator. Pass sizing/color via `className` (it's merged onto
 * the svg alongside `animate-spin stroke-current`, so e.g. "h-4 w-4 text-accent" both
 * sizes it and sets its color through currentColor). Matches the icon-only save-button
 * spinner already used in TaskCard.
 */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2.5}
      className={`animate-spin stroke-current ${className}`}
      role="status"
      aria-label="Loading"
    >
      <circle cx="12" cy="12" r="8.5" strokeDasharray="30 100" strokeLinecap="round" />
    </svg>
  );
}
