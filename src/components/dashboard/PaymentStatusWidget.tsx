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
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
      <h3 className="mb-4 text-sm font-semibold text-zinc-900 dark:text-zinc-50">Payment status</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {data.map((row) => (
          <div
            key={row.status}
            className="flex flex-col gap-1 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
          >
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: STATUS_COLOR_VAR[row.status] }} />
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                {PAYMENT_STATUS_LABELS[row.status]}
              </span>
            </div>
            <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{row.count}</div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {formatINR(row.totalReceived)} received of {formatINR(row.totalFinalCost)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
