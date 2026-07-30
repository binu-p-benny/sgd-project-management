/**
 * Wipes every project and reseeds a small demo set — 6 projects chosen to cover every
 * overall status, every phase, and every payment status between them.
 *
 * Run with: npx tsx scripts/reseed-demo.ts --yes
 *
 * Deletes all rows in projects (cascading to phase_steps, procurement_items and
 * step_status_log). Users are upserted, never deleted, so logins keep working.
 * Requires --yes, since there is no undo.
 */
import "dotenv/config";
import { prisma, seedUsers, seedProject, type ProjectSeed } from "../prisma/seed";
import {
  buildPhase1Steps,
  computePlannedDates,
  deriveVisitDurationDays,
} from "../src/lib/step-template";

/**
 * `delayed` is never stored — it's derived at read time from a step whose planned end has
 * passed (see overrun.ts). So a project's badge is really a function of createdDaysAgo:
 * far enough back and its open steps are overdue. The offsets below are picked to land
 * each project on the status named in its comment.
 */
const DEMO_PROJECTS: ProjectSeed[] = [
  {
    name: "Amber Court Windows",
    clientName: "Rohit Deshpande",
    clientPhone: "9876500011",
    clientAddress: "Flat 3B, Amber Court, Pune",
    finalCost: 960000,
    glassType: "normal",
    // Created today: 1A is due tomorrow, so nothing is overdue and it reads on_track. Even a
    // day or two back would tip it to Delayed, since 1A's planned duration is a single day.
    createdDaysAgo: 0,
    scenario: "just_started",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Green Valley Apartments Glazing",
    clientName: "Priya Menon",
    clientPhone: "9876500012",
    clientAddress: "Tower B, Green Valley Apartments, Kochi",
    finalCost: 1180000,
    glassType: "normal",
    createdDaysAgo: 6, // 1B blocked on site readiness -> blocked, phase 1
    scenario: "site_visit_blocked",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Coastal Heights Balcony Glazing",
    clientName: "Divya Nambiar",
    clientPhone: "9876500013",
    clientAddress: "Flat 402, Coastal Heights, Chennai",
    finalCost: 1100000,
    glassType: "normal",
    createdDaysAgo: 45, // procurement still open past its dates -> delayed, phase 2
    scenario: "phase2_procuring",
    paymentStatus: "partial",
    amountReceived: 550000,
  },
  {
    name: "Lakeside Office Curtain Wall",
    clientName: "Ferro Constructions Pvt Ltd",
    clientPhone: "9876500014",
    clientAddress: "Lakeside Business Park, Hyderabad",
    finalCost: 1500000,
    glassType: "laminated",
    createdDaysAgo: 40, // section held up by a vendor -> blocked, phase 2
    scenario: "phase2_blocked_vendor",
    paymentStatus: "partial",
    amountReceived: 750000,
  },
  {
    name: "Palm Grove Bungalow Windows",
    clientName: "Sunita Reddy",
    clientPhone: "9876500015",
    clientAddress: "Palm Grove Layout, Vizag",
    finalCost: 1050000,
    glassType: "normal",
    createdDaysAgo: 30, // installation under way and still within its dates -> on_track, phase 3
    scenario: "phase3_installing",
    paymentStatus: "partial",
    amountReceived: 900000,
  },
  {
    name: "Riverside Duplex Glazing",
    clientName: "Karthik Subramaniam",
    clientPhone: "9876500016",
    clientAddress: "Riverside Colony, Coimbatore",
    finalCost: 1350000,
    glassType: "normal",
    createdDaysAgo: 78, // all 13 steps done -> completed
    scenario: "completed",
    paymentStatus: "received",
    amountReceived: 1350000,
  },
];

/**
 * The "phase2_blocked_vendor" scenario in prisma/seed.ts leaves the section unarrived but never
 * actually blocks a step, so on its own it reads as on_track. Put a real blocker on the step the
 * vendor issue is holding up, so the demo set has a blocked project in phase 2 as well as one in
 * phase 1 (the site-not-ready case, which the scenario does block).
 */
async function blockStepForDemo(
  projectId: string,
  stepCode: string,
  actorId: string,
  reason: "vendor_issue_section",
  note: string
) {
  const step = await prisma.phaseStep.findFirstOrThrow({ where: { projectId, stepCode } });
  await prisma.phaseStep.update({
    where: { id: step.id },
    data: { status: "blocked", blockedReason: reason, blockedNote: note },
  });
  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: step.id,
      changedByUserId: actorId,
      oldStatus: step.status,
      newStatus: "blocked",
      reason: note,
    },
  });
}

/**
 * The scenarios stamp visit_urgency straight onto the project without giving 1B the duration it
 * implies (applyVisitUrgency does that at runtime, but the seed bypasses it). 1B is then left
 * with no planned end, and that propagates: 1C and 1D end up with no planned dates either.
 *
 * Written directly rather than via rescheduleProjectDates, which deliberately skips completed
 * steps — their dates are historical record, not a projection — and in these scenarios 1B/1C/1D
 * are exactly the completed ones that need filling in.
 */
async function applySeededVisitUrgency(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!project.visitUrgency) return;

  const duration = deriveVisitDurationDays(project.visitUrgency);
  if (duration === null) return; // site_not_ready: 1B is blocked with no duration, by design

  const template = buildPhase1Steps().map((s) =>
    s.stepCode === "1B" ? { ...s, plannedDurationDays: duration } : s
  );
  const dates = computePlannedDates(template, project.createdAt);

  for (const step of template) {
    const d = dates.get(step.stepCode)!;
    await prisma.phaseStep.updateMany({
      where: { projectId, stepCode: step.stepCode },
      data: {
        plannedStartDate: d.plannedStartDate,
        plannedEndDate: d.plannedEndDate,
        ...(step.stepCode === "1B" ? { plannedDurationDays: duration } : {}),
      },
    });
  }
}

/**
 * The scenario builders write step rows directly rather than going through step-actions, so
 * a project can end up holding a blocked step while overall_status still reads on_track.
 * Recompute it from what the steps actually say — the same rule refreshProjectOverallStatus
 * applies at runtime.
 */
async function syncOverallStatus(projectId: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (project.currentPhase === "completed") return;

  const blocked = await prisma.phaseStep.count({ where: { projectId, status: "blocked" } });
  const nextStatus = blocked > 0 ? "blocked" : "on_track";
  if (nextStatus !== project.overallStatus) {
    await prisma.project.update({ where: { id: projectId }, data: { overallStatus: nextStatus } });
  }
}

async function main() {
  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes: this deletes every project in the database.");
    process.exit(1);
  }

  const existing = await prisma.project.count();
  console.log(`Deleting ${existing} existing project(s) and everything attached to them...`);
  const { count } = await prisma.project.deleteMany({});
  console.log(`  deleted ${count}`);

  console.log("Upserting demo users (existing accounts are kept)...");
  const users = await seedUsers();

  console.log("Seeding demo projects...");
  for (const seed of DEMO_PROJECTS) {
    await seedProject(seed, users);
    // seedProject doesn't hand back the row, and names are unique within this set.
    const project = await prisma.project.findFirstOrThrow({ where: { name: seed.name } });
    await applySeededVisitUrgency(project.id);
    if (seed.scenario === "phase2_blocked_vendor") {
      await blockStepForDemo(
        project.id,
        "2D2",
        users.design_engineer.id,
        "vendor_issue_section",
        "Section delivery slipped — site measurement can't be finalised until it lands"
      );
    }
    await syncOverallStatus(project.id);
    console.log(`  created "${seed.name}" (${seed.scenario})`);
  }

  const summary = await prisma.project.findMany({
    select: { name: true, currentPhase: true, overallStatus: true, paymentStatus: true },
    orderBy: { createdAt: "asc" },
  });
  console.table(summary);
  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
