/**
 * Manual-test helper for the overdue-notification feature (src/lib/notify-overdue.ts).
 * Read-only unless given a sub-command. Not wired into package.json — run it directly:
 *
 *   npx tsx -r dotenv/config scripts/overdue-probe.ts                    # what the next cron run would notify + recent notifications
 *   npx tsx -r dotenv/config scripts/overdue-probe.ts seed <email>       # one fake notification for that user (UI-only test, no cron)
 *   npx tsx -r dotenv/config scripts/overdue-probe.ts backdate <stepId>  # make one step overdue (2 days ago) and clear its guard
 *   npx tsx -r dotenv/config scripts/overdue-probe.ts reset <stepId>     # planned end back to +7 days, clear the guard
 *   npx tsx -r dotenv/config scripts/overdue-probe.ts undo <stepId>      # remove that step's notifications and clear its guard
 *   npx tsx -r dotenv/config scripts/overdue-probe.ts undo-seed          # remove only the PROBE rows created by `seed`
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const [cmd, arg] = process.argv.slice(2);
const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const PROBE_MESSAGE = "PROBE — fake overdue notification for UI testing";

async function main() {
  if (cmd === "seed") {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: arg } });
    // Staggered ages so the dropdown shows every relative-time wording at once.
    const agesInMinutes = [0, 1, 5, 42, 60, 180, 1500, 4320, 28_800];
    const count = Number(process.argv[4]) || agesInMinutes.length;
    const rows = agesInMinutes.slice(0, count).map((mins, i) => ({
      userId: user.id,
      type: "step_overdue",
      message: `${PROBE_MESSAGE} #${i + 1}`,
      createdAt: new Date(Date.now() - mins * 60_000),
    }));
    const r = await prisma.notification.createMany({ data: rows });
    console.log(`created ${r.count} notification(s) for ${arg}`);
    return;
  }
  if (cmd === "backdate") {
    const s = await prisma.phaseStep.update({
      where: { id: arg },
      data: { plannedEndDate: days(-2), notifiedOverdueAt: null },
      include: { project: { select: { name: true } } },
    });
    console.log(`backdated ${s.stepCode} on ${s.project.name} -> planned end ${s.plannedEndDate?.toISOString()}`);
    return;
  }
  if (cmd === "reset") {
    const s = await prisma.phaseStep.update({
      where: { id: arg },
      data: { plannedEndDate: days(7), notifiedOverdueAt: null },
    });
    console.log(`reset ${s.stepCode} -> planned end ${s.plannedEndDate?.toISOString()}`);
    return;
  }
  if (cmd === "undo") {
    const removed = await prisma.notification.deleteMany({ where: { phaseStepId: arg } });
    await prisma.phaseStep.update({ where: { id: arg }, data: { notifiedOverdueAt: null } });
    console.log(`removed ${removed.count} notification(s) for step ${arg}, guard cleared`);
    return;
  }
  if (cmd === "undo-seed") {
    const removed = await prisma.notification.deleteMany({ where: { message: { startsWith: PROBE_MESSAGE } } });
    console.log(`removed ${removed.count} PROBE notification(s)`);
    return;
  }

  const candidates = await prisma.phaseStep.findMany({
    where: { plannedEndDate: { lt: new Date() }, status: { not: "completed" }, notifiedOverdueAt: null },
    include: { project: { select: { name: true } } },
    orderBy: { plannedEndDate: "asc" },
  });
  console.log(`\nSteps the next cron run WOULD notify: ${candidates.length}`);
  for (const s of candidates.slice(0, 15)) {
    console.log(
      `  ${s.id}  ${s.stepCode.padEnd(4)} ${s.status.padEnd(12)} due ${s.plannedEndDate?.toISOString().slice(0, 10)}  ${s.project.name}`
    );
  }
  if (candidates.length > 15) console.log(`  … and ${candidates.length - 15} more`);

  const recent = await prisma.notification.findMany({
    orderBy: { createdAt: "desc" },
    take: 10,
    include: { user: { select: { email: true } } },
  });
  console.log(`\nMost recent notifications (total ${await prisma.notification.count()}):`);
  for (const n of recent) {
    console.log(`  ${n.createdAt.toISOString()}  ${n.readAt ? "read  " : "UNREAD"}  ${n.user.email.padEnd(22)} ${n.message}`);
  }
  console.log();
}

main().finally(() => prisma.$disconnect());
