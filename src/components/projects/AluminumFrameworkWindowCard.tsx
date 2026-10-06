import {
  ALUMINUM_FRAMEWORK_START_OFFSET_DAYS,
  ALUMINUM_FRAMEWORK_END_OFFSET_DAYS,
  type AluminumFrameworkPlannedWindow,
} from "@/lib/procurement";

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function DateTile({ label, date, basis }: { label: string; date: Date; basis: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-overlay px-4 py-3">
      <dt className="text-xs font-medium text-fg-muted">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums text-fg">{formatDate(date)}</dd>
      <dd className="text-xs text-fg-subtle">{basis}</dd>
    </div>
  );
}

/**
 * A read-only preview of when the aluminum framework (3C1) will run, shown just above
 * InstallationWindowCard — the same "forecast ahead of the real step" idea, just counted
 * backward from Installation's own forecasted start instead of forward from procurement. Renders
 * nothing until that start date exists (see InstallationWindowCard's own null case — before 1D
 * completes there is nothing yet to count backward from). Purely informational: 3C1's own
 * plannedStartDate/plannedEndDate stay whatever they already are, set independently by an admin
 * editor or the step template's own default — this card never writes to them.
 */
export function AluminumFrameworkWindowCard({ plannedWindow }: { plannedWindow: AluminumFrameworkPlannedWindow | null }) {
  if (!plannedWindow) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-dashed border-edge-2 bg-surface p-4 sm:p-5">
      <div className="flex items-start gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
            <rect x="4" y="5" width="16" height="15" rx="1.5" />
            <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-fg">Phase 3 · Aluminum framework</h3>
            <span className="rounded-full bg-overlay px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle ring-1 ring-inset ring-edge">
              Forecast
            </span>
          </div>
          <p className="text-xs text-fg-muted">
            When the aluminum framework (3C1) is expected to run, forecast from Installation&rsquo;s own forecasted
            start date. Not editable here; updates automatically.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DateTile
          label="Aluminum framework planned start date"
          date={plannedWindow.start}
          basis={`Installation forecasted start date - ${ALUMINUM_FRAMEWORK_START_OFFSET_DAYS} days, excluding Sundays`}
        />
        <DateTile
          label="Aluminum framework planned end date"
          date={plannedWindow.end}
          basis={`Installation forecasted start date - ${ALUMINUM_FRAMEWORK_END_OFFSET_DAYS} day, excluding Sundays`}
        />
      </dl>

      <p className="text-xs text-fg-subtle">
        Installation forecasted start date used: {formatDate(plannedWindow.installationStart)}
      </p>
    </section>
  );
}
