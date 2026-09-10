/** 0–100 score band → chart status colour (green good … red critical), the same CSS vars the
 *  dashboard widgets theme with so light/dark both track the app. Plain module (no "use client")
 *  so the server page and the client chart can both call it. */
export function scoreColorVar(score: number): string {
  if (score >= 80) return "var(--chart-status-good)";
  if (score >= 60) return "var(--chart-status-warning)";
  if (score >= 40) return "var(--chart-status-serious)";
  return "var(--chart-status-critical)";
}
