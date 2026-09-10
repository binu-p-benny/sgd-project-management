/**
 * Shared loading indicator — the classic CSS spinner (a ring with one edge left transparent,
 * spun via Tailwind's built-in `animate-spin`), the same shape as "The Classic CSS Loaders
 * Collection"'s own rotating-ring loader rather than a hand-drawn SVG. Pass sizing/color via
 * `className` — the ring's color follows `currentColor` (`border-current`), so dropping it into
 * a colored button or colored text keeps it matching without any extra prop.
 */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent align-middle ${className}`}
    />
  );
}
