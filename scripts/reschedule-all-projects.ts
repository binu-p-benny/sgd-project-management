/**
 * One-off backfill: re-runs rescheduleProjectDates over every project, so stored Phase 1/2 (and
 * 3C2) planned dates computed before Sundays were skipped (see working-days.ts) are brought onto
 * the working-day rule. Procurement, glass-PO, review and service planned dates are all computed
 * live at read time and need nothing — only phase_steps.planned_start_date/planned_end_date are
 * stored, and those otherwise only move the next time something on that project triggers a
 * reschedule. Completed steps are never touched (rescheduleProjectDates' own rule).
 *
 * Not wired into package.json — run it directly, and it refuses to write without --yes:
 *
 *   npx tsx -r dotenv/config scripts/reschedule-all-projects.ts --yes
 *
 * One deliberate difference from a plain reschedule: rescheduleProjectDates clears
 * notified_overdue_at whenever a step's planned end moves, so the nightly overdue cron would
 * re-notify every already-notified overdue step whose date shifted by a day for a Sunday. Here,
 * a step that had already been notified and is *still* overdue under its new date keeps its
 * original notified_overdue_at — the notification it got is still true. One that's no longer
 * overdue is left cleared, so it's notified again if and when it really does go overdue.
 */
import { prisma } from "@/lib/prisma";
import { rescheduleProjectDates } from "@/lib/reschedule";
import { isSunday } from "@/lib/working-days";

type StepSnapshot = {
  id: string;
  projectId: string;
  stepCode: string;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  notifiedOverdueAt: Date | null;
};

async function openSteps(): Promise<Map<string, StepSnapshot>> {
  const rows = await prisma.phaseStep.findMany({
    where: { status: { not: "completed" } },
    select: { id: true, projectId: true, stepCode: true, plannedStartDate: true, plannedEndDate: true, notifiedOverdueAt: true },
  });
  return new Map(rows.map((r) => [r.id, r]));
}

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");
const countSundays = (steps: Iterable<StepSnapshot>) =>
  [...steps].filter((s) => (s.plannedStartDate && isSunday(s.plannedStartDate)) || (s.plannedEndDate && isSunday(s.plannedEndDate))).length;

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to write without --yes. This rewrites stored planned dates for every open phase step.");
    process.exit(1);
  }
  const host = (process.env.DATABASE_URL ?? "").replace(/^.*@([^/:]+).*$/, "$1");
  console.log(`Target database host: ${host}`);

  const before = await openSteps();
  const projects = await prisma.project.findMany({ select: { id: true } });
  for (const { id } of projects) {
    await rescheduleProjectDates(id);
  }
  const after = await openSteps();

  const now = new Date();
  let moved = 0;
  let preserved = 0;
  for (const [id, prev] of before) {
    const next = after.get(id);
    if (!next) continue;
    if (sameTime(prev.plannedStartDate, next.plannedStartDate) && sameTime(prev.plannedEndDate, next.plannedEndDate)) continue;
    moved += 1;
    console.log(
      `${prev.stepCode.padEnd(4)} ${prev.projectId}  start ${day(prev.plannedStartDate)} -> ${day(next.plannedStartDate)}  end ${day(prev.plannedEndDate)} -> ${day(next.plannedEndDate)}`
    );
    const stillOverdue = next.plannedEndDate !== null && next.plannedEndDate < now;
    if (prev.notifiedOverdueAt && next.notifiedOverdueAt === null && stillOverdue) {
      await prisma.phaseStep.update({ where: { id }, data: { notifiedOverdueAt: prev.notifiedOverdueAt } });
      preserved += 1;
    }
  }

  console.log(
    `\n${projects.length} projects rescheduled; ${moved} open steps moved; ${preserved} already-sent overdue notifications kept (still overdue).`
  );
  console.log(`Open steps with a Sunday planned date: ${countSundays(before.values())} before, ${countSundays(after.values())} after.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
