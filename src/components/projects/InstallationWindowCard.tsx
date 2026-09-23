import {
  INSTALLATION_WINDOW_START_OFFSET_DAYS,
  INSTALLATION_WINDOW_END_OFFSET_DAYS,
  type InstallationPlannedWindow,
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
 * A read-only preview of Phase 3, shown between Phase 1 and Phase 2 on the project detail page
 * once it's forecastable — so the team can see roughly when installation (3C2) will run well
 * ahead of Phase 2 actually finishing. Renders nothing at all until then: `plannedWindow` is null
 * until procurement's QC checked planned date exists (right after 1D completes — see
 * computeInstallationPlannedWindow), in which case there is nothing yet worth calling "Phase 3"
 * for. Kept visible even once the real Phase 3 section exists (with 3C2 showing these same dates
 * by default — see rescheduleProjectDates's own 3C2 handling) so this stays a quick, no-scrolling
 * reference — 3C2's own row is the source of truth if an admin has since overridden its dates.
 */
export function InstallationWindowCard({ plannedWindow }: { plannedWindow: InstallationPlannedWindow | null }) {
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
            <h3 className="font-medium text-fg">Phase 3 · Installation</h3>
            <span className="rounded-full bg-overlay px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-fg-subtle ring-1 ring-inset ring-edge">
              Forecast
            </span>
          </div>
          <p className="text-xs text-fg-muted">
            When Installation (3C2) is expected to run, forecast from procurement&rsquo;s QC checked planned date.
            Not editable here; updates automatically.
          </p>
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <DateTile
          label="Installation planned start date"
          date={plannedWindow.start}
          basis={`QC checked planned date + ${INSTALLATION_WINDOW_START_OFFSET_DAYS} days, excluding Sundays`}
        />
        <DateTile
          label="Installation planned end date"
          date={plannedWindow.end}
          basis={`QC checked planned date + ${INSTALLATION_WINDOW_END_OFFSET_DAYS} days, excluding Sundays`}
        />
      </dl>

      <p className="text-xs text-fg-subtle">
        QC checked planned date used: {formatDate(plannedWindow.qcPlanned)} (latest across procurement items)
      </p>
    </section>
  );
}
