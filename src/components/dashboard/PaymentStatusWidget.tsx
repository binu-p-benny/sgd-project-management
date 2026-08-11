import type { PaymentStatusRow } from "@/lib/dashboard";
import { PAYMENT_STATUS_LABELS } from "@/lib/labels";

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
    notation: amount >= 10000000 ? "compact" : "standard",
  }).format(amount);
}

const STATUS_COLOR_VAR: Record<string, string> = {
  pending: "var(--chart-status-warning)",
  partial: "var(--chart-series-1)",
  received: "var(--chart-status-good)",
};

export function PaymentStatusWidget({ data }: { data: PaymentStatusRow[] }) {
  return (
    <div className="rounded-xl border border-edge border-t-4 border-t-emerald-500 bg-gradient-to-br from-emerald-50 to-70% to-surface p-4 dark:from-emerald-500/10 shadow-[var(--shadow-sm)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] sm:p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
            <rect x="3.5" y="6.5" width="17" height="12" rx="2" />
            <path d="M3.5 10.5h17" />
            <circle cx="16.5" cy="14.5" r="1" fill="currentColor" stroke="none" />
          </svg>
        </span>
        <h3 className="text-sm font-semibold text-fg">Payment status</h3>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.map((row) => (
          <div
            key={row.status}
            className="flex flex-col gap-1 rounded-lg border border-edge p-3 transition-colors hover:border-edge-2 hover:bg-overlay"
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLOR_VAR[row.status] }} />
              <span className="text-xs font-medium uppercase tracking-wide text-fg-muted">
                {PAYMENT_STATUS_LABELS[row.status]}
              </span>
            </div>
            <div className="text-2xl font-semibold text-fg">{row.count}</div>
            <div className="text-xs text-fg-muted">
              {formatINR(row.totalReceived)} received of {formatINR(row.totalFinalCost)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
