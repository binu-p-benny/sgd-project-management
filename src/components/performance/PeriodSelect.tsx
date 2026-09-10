"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { PERIOD_OPTIONS, type KpiRange } from "@/lib/department-kpi";
import { Spinner } from "@/components/ui/Spinner";

const controlCls =
  "h-10 rounded-lg border border-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50 sm:h-9";

/** Drives the /performance page's time window via `?period=…` (plus `&from=&to=` for a custom
 *  range) — server-rendered on the other side, so the whole page and the URL reflect the choice
 *  and stay shareable. The recompute is a server round-trip, so the change is wrapped in a
 *  transition: the controls disable and a spinner shows next to them until the new figures land. */
export function PeriodSelect({ range }: { range: KpiRange }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function go(period: string, from?: string, to?: string) {
    const params = new URLSearchParams({ period });
    if (period === "custom") {
      if (from) params.set("from", from);
      if (to) params.set("to", to);
    }
    startTransition(() => router.push(`/performance?${params.toString()}`));
  }

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <select
        aria-label="Reporting period"
        value={range.period}
        disabled={pending}
        onChange={(e) =>
          // Switching *to* custom keeps whatever bounds the last preset resolved to, so the
          // date inputs open populated rather than blank.
          e.target.value === "custom"
            ? go("custom", range.fromInput, range.toInput)
            : go(e.target.value)
        }
        className={controlCls}
      >
        {PERIOD_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {range.period === "custom" && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-fg-muted">
            <span className="hidden sm:inline">From</span>
            <input
              type="date"
              aria-label="From date"
              value={range.fromInput}
              max={range.toInput || undefined}
              disabled={pending}
              onChange={(e) => go("custom", e.target.value, range.toInput)}
              className={controlCls}
            />
          </label>
          <label className="flex items-center gap-1.5 text-sm text-fg-muted">
            <span className="hidden sm:inline">to</span>
            <input
              type="date"
              aria-label="To date"
              value={range.toInput}
              min={range.fromInput || undefined}
              disabled={pending}
              onChange={(e) => go("custom", range.fromInput, e.target.value)}
              className={controlCls}
            />
          </label>
        </div>
      )}

      {pending && <Spinner className="h-4 w-4 text-fg-muted" />}
    </div>
  );
}
