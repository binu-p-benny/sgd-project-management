import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { matchesInstallationWindowFilter } from "@/lib/project-filters";

// 3C1 and 3C2 are the only phase steps this sheet needs directly — everything else comes off
// the project's Glass PO row (see COLUMNS below). Kept as a typed tuple so the prisma `in` filter
// and the byCode lookups below share one list.
const SCHEDULE_STEP_CODES = ["3C1", "3C2"] as const;

interface ScheduleStep {
  stepCode: string;
  status: "not_started" | "in_progress" | "blocked" | "completed";
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
  contractorId: string | null;
  contractor: { name: string } | null;
}

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function formatCellDate(date: Date | null): string {
  if (!date) return "";
  return `${MONTH_SHORT[date.getUTCMonth()]}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** The sheet's 10 date columns, in order — each a plain field read straight off the Glass PO row
 *  or the 3C1/3C2 step, per the exact column list this was built to (no more "C"/planned-date
 *  collapsing — every cell is just that field's own date, blank if it hasn't happened/been set). */
interface ScheduleRow {
  customer: string;
  dates: (Date | null)[];
  // Row order within its contractor group — Installation's planned start, the same anchor the
  // paper schedule itself sorts by (earliest install first), falling back down the chain so a
  // project without one yet still sorts sensibly rather than landing arbitrarily.
  sortDate: Date | null;
}

const COLUMN_HEADERS = [
  "SL",
  "CUSTOMER",
  "Glass Requirement Created",
  "Glass Arrival",
  "Aluminum framework planned start",
  "Aluminum framework planned end",
  "Aluminum framework actual start",
  "Aluminum framework actual end",
  "Installation planned start",
  "Installation planned end",
  "Installation actual start",
  "Installation actual end",
];

/** Pastel fills cycled across contractor groups — not trying to match the paper sheet's exact
 *  palette, just its "each contractor gets its own color band" idea. "Unassigned" always gets
 *  its own neutral gray instead (see buildWorkbook), regardless of where it'd otherwise fall in
 *  the cycle. */
const GROUP_COLORS = ["FFF2CC", "FCE4EC", "E1F0FF", "E8F5E9", "FFE8D6", "F3E5F5", "FFF9C4", "D8F5F0"];
const UNASSIGNED_COLOR = "ECECEC";
const HEADER_FILL = "D9E2F3";

function buildWorkbook(
  groups: { contractorName: string | null; rows: ScheduleRow[] }[],
  titleText: string
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Schedule");
  const colCount = COLUMN_HEADERS.length;

  sheet.columns = [
    { width: 6 },
    { width: 22 },
    { width: 16 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
    { width: 16 },
  ];

  const titleRow = sheet.addRow([titleText]);
  sheet.mergeCells(titleRow.number, 1, titleRow.number, colCount);
  titleRow.getCell(1).font = { bold: true, size: 13 };
  titleRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
  titleRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
  titleRow.height = 22;
  sheet.addRow([]);

  let serial = 0;
  let colorIndex = 0;

  for (const group of groups) {
    const isUnassigned = group.contractorName === null;
    const bandColor = isUnassigned ? UNASSIGNED_COLOR : GROUP_COLORS[colorIndex % GROUP_COLORS.length];
    if (!isUnassigned) colorIndex++;

    const bandRow = sheet.addRow([group.contractorName ?? "Unassigned"]);
    sheet.mergeCells(bandRow.number, 1, bandRow.number, colCount);
    bandRow.getCell(1).font = { bold: true, size: 11 };
    bandRow.getCell(1).alignment = { horizontal: "center", vertical: "middle" };
    bandRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${bandColor}` } };
    bandRow.height = 20;

    const headRow = sheet.addRow(COLUMN_HEADERS);
    for (let c = 1; c <= colCount; c++) {
      const cell = headRow.getCell(c);
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${HEADER_FILL}` } };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
    }
    headRow.height = 30;

    for (const row of group.rows) {
      serial++;
      const dataRow = sheet.addRow([serial, row.customer, ...row.dates.map(formatCellDate)]);
      for (let c = 1; c <= colCount; c++) {
        const cell = dataRow.getCell(c);
        cell.alignment = { horizontal: c === 2 ? "left" : "center", vertical: "middle" };
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
        cell.font = { size: 10 };
      }
    }

    sheet.addRow([]);
  }

  return workbook;
}

/** Human label for the currently-applied window, for the sheet's own title band — e.g. "Sep 2026"
 *  for a single-month range, "Jul–Sep 2026" spanning months, or a generic fallback with no range
 *  applied at all (the export then covers every project that's reached 3C2, same as the
 *  /projects list itself shows with the filter cleared). */
function describeWindow(from: Date | null, to: Date | null): string {
  if (!from && !to) return "Installation Schedule — All Projects";
  const fmt = (d: Date) => `${MONTH_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (from && to) {
    return from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth()
      ? `${fmt(from)} — Installation Schedule`
      : `${MONTH_SHORT[from.getUTCMonth()]}–${fmt(to)} — Installation Schedule`;
  }
  return `${fmt((from ?? to)!)} — Installation Schedule`;
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const installFromParam = searchParams.get("installFrom");
  const installToParam = searchParams.get("installTo");
  const installFrom = installFromParam ? new Date(installFromParam) : null;
  const installTo = installToParam ? new Date(`${installToParam}T23:59:59.999`) : null;

  const projects = await prisma.project.findMany({
    include: {
      client: { select: { name: true } },
      phaseSteps: {
        where: { stepCode: { in: [...SCHEDULE_STEP_CODES] } },
        select: {
          stepCode: true,
          status: true,
          plannedStartDate: true,
          plannedEndDate: true,
          actualStartDate: true,
          actualEndDate: true,
          contractorId: true,
          contractor: { select: { name: true } },
        },
      },
      glassPurchaseOrder: { select: { requirementCreatedAt: true, actualArrivalDate: true } },
    },
  });

  const groupsByContractor = new Map<string | null, ScheduleRow[]>();

  for (const project of projects) {
    // No range applied: every project that's reached 3C2 at all, dated or not — same as the
    // /projects list itself shows with this filter cleared. A range applied means an actual
    // overlap is required (matchesInstallationWindowFilter needs real planned dates for that).
    const hasReachedInstallation = project.phaseSteps.some((s) => s.stepCode === "3C2");
    if (!hasReachedInstallation) continue;
    if ((installFrom || installTo) && !matchesInstallationWindowFilter(project.phaseSteps, installFrom, installTo)) {
      continue;
    }

    const byCode = new Map(project.phaseSteps.map((s) => [s.stepCode, s as ScheduleStep]));
    const frameWork = byCode.get("3C1");
    const install = byCode.get("3C2");

    const dates = [
      project.glassPurchaseOrder?.requirementCreatedAt ?? null,
      project.glassPurchaseOrder?.actualArrivalDate ?? null,
      frameWork?.plannedStartDate ?? null,
      frameWork?.plannedEndDate ?? null,
      frameWork?.actualStartDate ?? null,
      frameWork?.actualEndDate ?? null,
      install?.plannedStartDate ?? null,
      install?.plannedEndDate ?? null,
      install?.actualStartDate ?? null,
      install?.actualEndDate ?? null,
    ];

    const contractorName = frameWork?.contractor?.name ?? null;
    const sortDate =
      install?.plannedStartDate ?? install?.actualStartDate ?? install?.plannedEndDate ?? install?.actualEndDate ?? null;
    const row: ScheduleRow = { customer: project.client.name, dates, sortDate };

    const list = groupsByContractor.get(contractorName) ?? [];
    list.push(row);
    groupsByContractor.set(contractorName, list);
  }

  const groups = [...groupsByContractor.entries()]
    .sort(([a], [b]) => {
      if (a === null) return 1;
      if (b === null) return -1;
      return a.localeCompare(b);
    })
    .map(([contractorName, rows]) => ({
      contractorName,
      rows: rows.sort((a, b) => {
        if (a.sortDate === null && b.sortDate === null) return 0;
        if (a.sortDate === null) return 1;
        if (b.sortDate === null) return -1;
        return a.sortDate.getTime() - b.sortDate.getTime();
      }),
    }));

  const workbook = buildWorkbook(groups, describeWindow(installFrom, installTo));
  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="Installation Schedule.xlsx"',
    },
  });
}
