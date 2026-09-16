import type { Department } from "@prisma/client";

/**
 * Pure scoring + period helpers for the owner-only /performance page — no DB, no server-only
 * imports, so client components (the period selector, the chart) can pull types and the option
 * list from here without dragging Prisma into the browser bundle. The queries that actually read
 * the database live in department-kpi-report.ts.
 *
 * The headline question is "was the work finished on or before its planned date". A unit of
 * work is credited to exactly one department (its structural owner), so nothing is
 * double-counted.
 */

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

export type KpiPeriod =
  | "this_month"
  | "last_month"
  | "last_30_days"
  | "last_3_months"
  | "this_year"
  | "last_year"
  | "all_time"
  | "custom";

export const PERIOD_OPTIONS: { value: KpiPeriod; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "last_30_days", label: "Last 30 days" },
  { value: "last_3_months", label: "Last 3 months" },
  { value: "this_year", label: "This year" },
  { value: "last_year", label: "Last year" },
  { value: "all_time", label: "All time" },
  { value: "custom", label: "Custom dates…" },
];

const DEFAULT_PERIOD: KpiPeriod = "this_month";

export function parseKpiPeriod(raw: string | undefined): KpiPeriod {
  return PERIOD_OPTIONS.some((o) => o.value === raw) ? (raw as KpiPeriod) : DEFAULT_PERIOD;
}

export interface KpiRange {
  period: KpiPeriod;
  /** null for "all_time" (and for a custom range with no start) — no lower bound. */
  start: Date | null;
  end: Date;
  /** Standalone name, e.g. "Last 30 days". */
  label: string;
  /** Fits after "…completed", e.g. "in the last 30 days" / "this month" / "to date". */
  phrase: string;
  /** The raw yyyy-mm-dd strings backing a custom range — echoed into the date inputs. */
  fromInput: string;
  toInput: string;
}

const toDMY = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(d);
const toIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Parses a `yyyy-mm-dd` string (from a `<input type="date">`) as a *local* calendar day —
 *  start-of-day, or end-of-day when `endOfDay`. Null for anything unparseable. */
export function parseLocalDate(raw: string | undefined, endOfDay = false): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const [, y, mo, d] = m.map(Number);
  const date = endOfDay
    ? new Date(y, mo - 1, d, 23, 59, 59, 999)
    : new Date(y, mo - 1, d, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Turns whatever's in the URL (`?period=…&from=…&to=…`) into a concrete range. Presets defer to
 * resolvePeriodRange; `custom` reads the two date inputs (forgiving — a missing bound just
 * drops that side, and from/to are swapped if reversed).
 */
export function resolveKpiRange(
  input: { period?: string; from?: string; to?: string },
  now = new Date()
): KpiRange {
  const period = parseKpiPeriod(input.period);
  if (period !== "custom") return resolvePeriodRange(period, now);

  let start = parseLocalDate(input.from, false);
  let end = parseLocalDate(input.to, true) ?? now;
  if (start && start > end) [start, end] = [parseLocalDate(input.to, false)!, parseLocalDate(input.from, true)!];

  const label = start ? `${toDMY(start)} – ${toDMY(end)}` : `Up to ${toDMY(end)}`;
  const phrase = start ? `between ${toDMY(start)} and ${toDMY(end)}` : `up to ${toDMY(end)}`;
  return { period, start, end, label, phrase, fromInput: start ? toIso(start) : "", toInput: toIso(end) };
}

/** Resolves a preset period key to a concrete `[start, end]`. `end` is "now" for the live
 *  periods and the boundary for the closed ones (last month / last year). */
export function resolvePeriodRange(period: Exclude<KpiPeriod, "custom">, now = new Date()): KpiRange {
  const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
  const startOfYear = (d: Date) => new Date(d.getFullYear(), 0, 1);
  const daysAgo = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

  let base: { start: Date | null; end: Date; label: string; phrase: string };
  switch (period) {
    case "last_month": {
      const thisMonthStart = startOfMonth(now);
      const start = new Date(thisMonthStart.getFullYear(), thisMonthStart.getMonth() - 1, 1);
      base = { start, end: thisMonthStart, label: "Last month", phrase: "last month" };
      break;
    }
    case "last_30_days":
      base = { start: daysAgo(30), end: now, label: "Last 30 days", phrase: "in the last 30 days" };
      break;
    case "last_3_months":
      base = { start: daysAgo(90), end: now, label: "Last 3 months", phrase: "in the last 3 months" };
      break;
    case "this_year":
      base = { start: startOfYear(now), end: now, label: "This year", phrase: "this year" };
      break;
    case "last_year": {
      const thisYearStart = startOfYear(now);
      base = { start: new Date(thisYearStart.getFullYear() - 1, 0, 1), end: thisYearStart, label: "Last year", phrase: "last year" };
      break;
    }
    case "all_time":
      base = { start: null, end: now, label: "All time", phrase: "to date" };
      break;
    case "this_month":
    default:
      base = { start: startOfMonth(now), end: now, label: "This month", phrase: "this month" };
  }

  // Echo the resolved bounds as the date-input values, so switching to "Custom dates…" starts
  // from wherever the last preset left off rather than empty.
  return {
    period,
    ...base,
    fromInput: base.start ? toIso(base.start) : "",
    toInput: toIso(base.end),
  };
}

export function inRange(date: Date, range: KpiRange): boolean {
  if (range.start && date < range.start) return false;
  return date <= range.end;
}

// ---------------------------------------------------------------------------
// Completed units
// ---------------------------------------------------------------------------

export type CompletionOutcome = "on_time" | "late" | "client_caused";
export type UnitSource =
  | "phase_step"
  | "procurement_stage"
  | "glass_po_stage"
  | "action_item"
  | "service_item"
  // The operation manager's own review of one of the 5 sources above (see task-reviews.ts) —
  // credited to operations_manager, never to whichever department did the original work.
  | "review";

export interface CompletedUnitRow {
  department: Department;
  source: UnitSource;
  /** Human label for the piece of work (step name, stage name, task label). */
  taskLabel: string;
  /** Project name — or Service title for a service item. */
  contextName: string;
  projectId: string;
  plannedDate: Date | null;
  completedDate: Date;
  /** Whole days late; 0 when on time or not assessable. Client-caused keeps its real value. */
  daysLate: number;
  outcome: CompletionOutcome;
  /** Whether this unit is itself a pass/fail QC check. */
  isQc: boolean;
  /** Only meaningful when isQc — the check's result. */
  qcPassed: boolean | null;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * End-of-day comparison so "planned Tuesday, done any time Tuesday" is on time. The planned day
 * is read in server-local time — the app is single-timezone. A slip the client caused (didn't
 * approve a drawing, didn't pay) is reclassified `client_caused` and won't count against the
 * team. Exported for its own unit tests — this call is the whole feature's crux.
 */
export function classifyCompletion(
  planned: Date | null,
  actual: Date,
  delayCategory: string | null
): { outcome: CompletionOutcome; daysLate: number } {
  if (!planned) return { outcome: "on_time", daysLate: 0 };
  const plannedEod = new Date(planned.getFullYear(), planned.getMonth(), planned.getDate(), 23, 59, 59, 999);
  if (actual <= plannedEod) return { outcome: "on_time", daysLate: 0 };
  const daysLate = Math.ceil((actual.getTime() - plannedEod.getTime()) / MS_PER_DAY);
  return { outcome: delayCategory === "client_side" ? "client_caused" : "late", daysLate };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoreComponents {
  /** (onTime + clientCaused) / assessed — null when nothing assessable was completed. */
  onTimeRate: number | null;
  /** passed / (passed + failed) — null when the dept ran no QC checks. */
  qcPassRate: number | null;
  /** 1 − overdueOpen / openOwned — null when the dept holds no open work. */
  backlogHealth: number | null;
}

const WEIGHTS = { onTime: 0.6, qc: 0.2, backlog: 0.2 } as const;

/**
 * Blends the components into a 0–100 score. On-time is the dominant term; any component with
 * no data (a dept with no QC work, or an empty backlog) drops out and its weight is spread
 * across the rest, so a department is never punished for work it simply doesn't do.
 * A department with nothing assessable at all scores 0.
 */
export function scoreDepartment(c: ScoreComponents): number {
  const parts: { value: number; weight: number }[] = [];
  if (c.onTimeRate !== null) parts.push({ value: c.onTimeRate, weight: WEIGHTS.onTime });
  if (c.qcPassRate !== null) parts.push({ value: c.qcPassRate, weight: WEIGHTS.qc });
  if (c.backlogHealth !== null) parts.push({ value: c.backlogHealth, weight: WEIGHTS.backlog });
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0);
  if (totalWeight === 0) return 0;
  const weighted = parts.reduce((s, p) => s + p.value * p.weight, 0) / totalWeight;
  return Math.round(weighted * 100);
}

export interface DepartmentKpiRow {
  department: Department;
  label: string;
  rank: number;
  score: number;
  components: ScoreComponents;
  completed: number;
  assessed: number;
  onTime: number;
  late: number;
  clientCaused: number;
  avgDaysLate: number | null;
  qcPassed: number;
  qcFailed: number;
  openOwned: number;
  overdueOpen: number;
}

export interface DepartmentKpiResult {
  range: KpiRange;
  rows: DepartmentKpiRow[];
  /** Late + client-caused completions only — the exceptions the owner needs to see, newest first. */
  lateUnits: CompletedUnitRow[];
}
