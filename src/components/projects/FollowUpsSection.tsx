import { DEPARTMENT_LABELS } from "@/lib/labels";
import type { FollowUpRow } from "@/lib/follow-ups";

export interface FollowUpGroup {
  key: string;
  /** The card these came from, worded the same as the button that raised them. */
  label: string;
  rows: FollowUpRow[];
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
}

/**
 * Every follow-up on the project in one place, grouped by the card it was raised from. The
 * per-card buttons are where they get added and closed; this is the "what is outstanding on this
 * project" read, which is otherwise scattered across a dozen cards a viewer would have to open
 * one at a time.
 *
 * Open ones first within a group, each by planned date, since a finished follow-up is history.
 */
export function FollowUpsSection({ groups }: { groups: FollowUpGroup[] }) {
  const all = groups.flatMap((g) => g.rows);
  if (all.length === 0) return null;

  const openCount = all.filter((r) => !r.actualDate).length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
            <path d="M4 7h16M4 12h10M4 17h7" strokeLinecap="round" />
            <path d="M16.5 16.5 19 19l3.5-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h2 className="text-lg font-semibold text-fg">Follow ups</h2>
        <span className="rounded-full bg-overlay px-2 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-edge">
          {openCount} open · {all.length} total
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((group) => {
          const rows = [...group.rows].sort((a, b) => {
            if (!a.actualDate !== !b.actualDate) return a.actualDate ? 1 : -1;
            return a.plannedDate.localeCompare(b.plannedDate);
          });
          return (
            <div key={group.key} className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-fg">{group.label}</span>
                <span className="text-xs font-medium text-fg-subtle">
                  {rows.filter((r) => !r.actualDate).length} open / {rows.length}
                </span>
              </div>
              <ul className="flex flex-col divide-y divide-edge">
                {rows.map((row) => {
                  const done = !!row.actualDate;
                  return (
                    <li key={row.id} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                        <span className={`text-sm ${done ? "text-fg-muted line-through" : "text-fg"}`}>
                          {row.taskLabel}
                        </span>
                        <span
                          className={`text-xs font-medium ${
                            done ? "text-emerald-600 dark:text-emerald-400" : "text-fg-muted"
                          }`}
                        >
                          {done ? `Done ${formatDate(row.actualDate!)}` : `Due ${formatDate(row.plannedDate)}`}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-fg-subtle">
                        <span>{DEPARTMENT_LABELS[row.department]}</span>
                        {row.createdByName && <span>Raised by {row.createdByName}</span>}
                        {row.note && <span className="text-fg-muted">{row.note}</span>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
