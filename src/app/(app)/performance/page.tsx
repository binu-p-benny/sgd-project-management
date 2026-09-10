import { resolveKpiRange, type DepartmentKpiRow, type CompletedUnitRow } from "@/lib/department-kpi";
import { getDepartmentKpis } from "@/lib/department-kpi-report";
import { PeriodSelect } from "@/components/performance/PeriodSelect";
import { DepartmentScoreChart } from "@/components/performance/DepartmentScoreChart";
import { scoreColorVar } from "@/components/performance/scoreColor";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function pct(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function OutcomeBadge({ outcome }: { outcome: CompletedUnitRow["outcome"] }) {
  if (outcome === "client_caused") {
    return (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-inset ring-slate-300 dark:bg-slate-500/10 dark:text-slate-300 dark:ring-slate-500/25">
        Client-caused
      </span>
    );
  }
  return (
    <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25">
      Late
    </span>
  );
}

export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const range = resolveKpiRange(params);

  let result;
  try {
    result = await getDepartmentKpis(range);
  } catch (error) {
    console.error("[performance] failed to compute department KPIs", error);
    throw new Error("Unable to compute department performance. Please try again shortly.");
  }

  const { rows, lateUnits } = result;
  const anyCompletions = rows.some((r) => r.completed > 0);
  const leader = anyCompletions ? rows[0] : null;

  const lateByDepartment = new Map<string, CompletedUnitRow[]>();
  for (const u of lateUnits) {
    const list = lateByDepartment.get(u.department) ?? [];
    list.push(u);
    lateByDepartment.set(u.department, list);
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
              <path d="M6 4h12v3a6 6 0 0 1-12 0V4Z" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 5H4a2 2 0 0 0 2 4M18 5h2a2 2 0 0 1-2 4M9 20h6M12 15v5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <div>
            <h1 className="text-xl font-semibold text-fg">Department performance</h1>
            <p className="text-sm text-fg-muted">
              Scored on tasks completed <span className="font-medium text-fg">{range.phrase}</span>
            </p>
          </div>
        </div>
        <PeriodSelect range={range} />
      </div>

      {!anyCompletions ? (
        <p className="rounded-lg border border-dashed border-edge-2 py-12 text-center text-sm text-fg-muted">
          No tasks were completed {range.phrase}. Pick a wider period to see department scores.
        </p>
      ) : (
        <>
          {/* Leader callout */}
          {leader && (
            <div className="flex flex-col gap-2 rounded-xl border border-edge border-t-4 border-t-amber-500 bg-gradient-to-br from-amber-50 to-70% to-surface p-4 shadow-[var(--shadow-sm)] dark:from-amber-500/10 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden>
                🏆
              </span>
              <div>
                <div className="text-sm text-fg-muted">Top performer this period</div>
                <div className="text-lg font-semibold text-fg">{leader.label}</div>
              </div>
            </div>
            <div className="flex items-baseline gap-4 text-sm">
              <span>
                <span className="text-2xl font-bold" style={{ color: scoreColorVar(leader.score) }}>
                  {leader.score}
                </span>
                <span className="text-fg-muted"> / 100</span>
              </span>
              <span className="text-fg-muted">
                {pct(leader.components.onTimeRate)} on time
                {leader.overdueOpen > 0 && ` · ${leader.overdueOpen} overdue now`}
              </span>
            </div>
          </div>
          )}

          <DepartmentScoreChart rows={rows} />

          {/* Ranked table — desktop */}
          <div className="hidden overflow-x-auto rounded-xl border border-edge sm:block">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="bg-surface text-[11px] uppercase tracking-wider text-fg-subtle">
                <tr>
                  <th className="px-4 py-3 font-medium">#</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Score</th>
                  <th className="px-4 py-3 font-medium">On time</th>
                  <th className="px-4 py-3 font-medium">Client-caused</th>
                  <th className="px-4 py-3 font-medium">Avg days late</th>
                  <th className="px-4 py-3 font-medium">QC pass</th>
                  <th className="px-4 py-3 font-medium">Overdue backlog</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-edge bg-surface">
                {rows.map((row) => (
                  <KpiTableRow key={row.department} row={row} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Ranked cards — mobile */}
          <div className="flex flex-col gap-3 sm:hidden">
            {rows.map((row) => (
              <KpiCard key={row.department} row={row} />
            ))}
          </div>

          {/* Late-completions drill-down */}
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-fg">
              Late completions <span className="font-normal text-fg-muted">({lateUnits.length})</span>
            </h2>
            {lateUnits.length === 0 ? (
              <p className="rounded-lg border border-dashed border-edge-2 py-6 text-center text-sm text-fg-muted">
                Every task completed in this period landed on or before its planned date.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {rows
                  .filter((r) => lateByDepartment.has(r.department))
                  .map((r) => (
                    <div key={r.department} className="overflow-hidden rounded-xl border border-edge">
                      <div className="flex items-center justify-between bg-surface px-4 py-2.5 text-sm font-medium text-fg">
                        <span>{r.label}</span>
                        <span className="text-xs font-normal text-fg-muted">
                          {lateByDepartment.get(r.department)!.length} of {r.assessed} assessed
                        </span>
                      </div>
                      <div className="divide-y divide-edge">
                        {lateByDepartment.get(r.department)!.map((u, i) => (
                          <div key={i} className="flex flex-col gap-1 px-4 py-2.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                              <div className="truncate font-medium text-fg">{u.taskLabel}</div>
                              <div className="truncate text-xs text-fg-muted">{u.contextName}</div>
                            </div>
                            <div className="flex shrink-0 items-center gap-3 text-xs text-fg-muted">
                              <span>
                                planned {formatDate(u.plannedDate)} · done {formatDate(u.completedDate)}
                              </span>
                              {u.outcome === "late" && (
                                <span className="font-medium text-red-600 dark:text-red-400">{u.daysLate}d late</span>
                              )}
                              <OutcomeBadge outcome={u.outcome} />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>

          <p className="text-xs text-fg-subtle">
            Each completed task is credited to the department that owns it. Client-caused slips (a drawing left
            unapproved, a payment not made) don&apos;t count against the team. The overdue-backlog figure is the
            department&apos;s standing right now, not period-scoped.
          </p>
        </>
      )}
    </div>
  );
}

function KpiTableRow({ row }: { row: DepartmentKpiRow }) {
  return (
    <tr className="bg-surface">
      <td className="px-4 py-3 font-mono text-fg-muted">{row.rank}</td>
      <td className="px-4 py-3 font-medium text-fg">{row.label}</td>
      <td className="px-4 py-3">
        <span className="text-base font-bold" style={{ color: scoreColorVar(row.score) }}>
          {row.score}
        </span>
      </td>
      <td className="px-4 py-3 text-fg-muted">
        {row.assessed > 0 ? (
          <>
            <span className="font-medium text-fg">{pct(row.components.onTimeRate)}</span>{" "}
            <span className="text-xs">({row.onTime + row.clientCaused}/{row.assessed})</span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-fg-muted">{row.clientCaused || "—"}</td>
      <td className="px-4 py-3 text-fg-muted">{row.avgDaysLate ?? "—"}</td>
      <td className="px-4 py-3 text-fg-muted">
        {row.qcPassed + row.qcFailed > 0 ? (
          <>
            <span className="font-medium text-fg">{pct(row.components.qcPassRate)}</span>{" "}
            <span className="text-xs">({row.qcPassed}/{row.qcPassed + row.qcFailed})</span>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-4 py-3 text-fg-muted">
        {row.openOwned > 0 ? (
          <span className={row.overdueOpen > 0 ? "text-amber-700 dark:text-amber-400" : undefined}>
            {row.overdueOpen}/{row.openOwned}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

function KpiCard({ row }: { row: DepartmentKpiRow }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-fg-muted">#{row.rank}</span>
          <span className="font-medium text-fg">{row.label}</span>
        </div>
        <span className="text-xl font-bold" style={{ color: scoreColorVar(row.score) }}>
          {row.score}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-fg-muted">
        <span>
          On time:{" "}
          <span className="text-fg">
            {row.assessed > 0 ? `${pct(row.components.onTimeRate)} (${row.onTime + row.clientCaused}/${row.assessed})` : "—"}
          </span>
        </span>
        <span>
          Client-caused: <span className="text-fg">{row.clientCaused || "—"}</span>
        </span>
        <span>
          Avg days late: <span className="text-fg">{row.avgDaysLate ?? "—"}</span>
        </span>
        <span>
          QC pass:{" "}
          <span className="text-fg">
            {row.qcPassed + row.qcFailed > 0 ? `${pct(row.components.qcPassRate)} (${row.qcPassed}/${row.qcPassed + row.qcFailed})` : "—"}
          </span>
        </span>
        <span>
          Overdue backlog:{" "}
          <span className={row.overdueOpen > 0 ? "text-amber-700 dark:text-amber-400" : "text-fg"}>
            {row.openOwned > 0 ? `${row.overdueOpen}/${row.openOwned}` : "—"}
          </span>
        </span>
      </div>
    </div>
  );
}
