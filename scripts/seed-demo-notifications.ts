/**
 * Fills the LOCAL dev database with a realistic spread of notifications, so the bell has
 * something to show without waiting for the nightly cron or manufacturing a block by hand.
 * Not wired into package.json — run it directly:
 *
 *   npx tsx -r dotenv/config scripts/seed-demo-notifications.ts         # seed
 *   npx tsx -r dotenv/config scripts/seed-demo-notifications.ts undo    # remove exactly what it seeded
 *
 * Every row is built from real rows already in the database (a genuinely blocked step, an item
 * that really did fail QC, a 3C1 with no contractor) and addressed through the same
 * resolveRecipients the app itself uses, so who receives what is real even though the rows are
 * seeded rather than earned. Nothing else is written: no project, step or item is modified.
 *
 * Every seeded row carries a dedupe_key starting "demo:", which is how `undo` finds them again
 * — and, since dedupe keys are unique per user, re-running the seed replaces nothing and
 * duplicates nothing.
 */
import { prisma } from "@/lib/prisma";
import { formatShortDate, resolveRecipients } from "@/lib/notifications";
import { getProjectDelayReasons } from "@/lib/overrun";
import { withLiveExpectedArrivalDates } from "@/lib/procurement";
import { BLOCKED_REASON_LABELS, stepStatusLabel } from "@/lib/labels";
import { addDays } from "@/lib/step-template";
import type { Department } from "@prisma/client";

const DEMO_KEY_PREFIX = "demo:";
const ITEM_TYPE_LABEL: Record<string, string> = { section: "Section", hardware: "Hardware", gasket: "Gasket" };

interface DemoNotification {
  type: string;
  message: string;
  projectId: string;
  phaseStepId?: string | null;
  departments: (Department | null | undefined)[];
  /** How long ago it was raised — spreads the list across every relative-time wording. */
  hoursAgo: number;
  read?: boolean;
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3_600_000);
}

/** Overdue steps → step_overdue, the kind that already existed. */
async function overdueStepExamples(limit: number): Promise<DemoNotification[]> {
  const steps = await prisma.phaseStep.findMany({
    where: { plannedEndDate: { lt: new Date() }, status: { not: "completed" } },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { plannedEndDate: "asc" },
    take: limit,
  });

  return steps.map((step, i) => ({
    type: "step_overdue",
    message: `${step.stepCode} ${step.stepName} on ${step.project.name} is overdue — was due ${formatShortDate(
      step.plannedEndDate!
    )}`,
    projectId: step.projectId,
    phaseStepId: step.id,
    departments: [step.owningDepartment, step.secondaryDepartment],
    hoursAgo: 2 + i * 26,
    read: i > 0,
  }));
}

/** Genuinely blocked steps → step_blocked, worded exactly as updateStepStatus words it. */
async function blockedStepExamples(limit: number): Promise<DemoNotification[]> {
  const steps = await prisma.phaseStep.findMany({
    where: { status: "blocked", blockedReason: { not: null } },
    include: { project: { select: { id: true, name: true } } },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  return steps.map((step, i) => ({
    type: "step_blocked",
    message: `${step.stepCode} ${step.stepName} on ${step.project.name} is ${stepStatusLabel(
      "blocked",
      step.phase
    ).toLowerCase()} — ${BLOCKED_REASON_LABELS[step.blockedReason!]}${
      step.blockedNote ? ` (${step.blockedNote})` : ""
    }`,
    projectId: step.projectId,
    phaseStepId: step.id,
    departments: [step.owningDepartment, step.secondaryDepartment],
    hoursAgo: [0.05, 9, 50][i] ?? 12 + i * 20,
  }));
}

/** A "Blocked work" block with every task done → block_ready. */
async function blockReadyExamples(limit: number): Promise<DemoNotification[]> {
  const blocks = await prisma.workBlock.findMany({
    where: { blockedPhaseStepId: { not: null } },
    include: {
      tasks: { select: { actualDate: true } },
      project: { select: { id: true, name: true } },
      blockedPhaseStep: {
        select: { id: true, stepCode: true, stepName: true, status: true, owningDepartment: true, secondaryDepartment: true },
      },
    },
    take: 20,
  });

  const ready = blocks
    .filter((b) => b.blockedPhaseStep && b.tasks.length > 0 && b.tasks.every((t) => t.actualDate))
    .slice(0, limit);

  // Nothing in this database has reached that state yet — fall back to an illustrative row
  // against a real blocked step, so the bell still shows what this kind looks like.
  if (ready.length === 0) {
    const step = await prisma.phaseStep.findFirst({
      where: { status: "blocked" },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!step) return [];
    return [
      {
        type: "block_ready",
        message: `All 2 blocked-work tasks on ${step.project.name} are done — ${step.stepCode} ${step.stepName} is ready to resume`,
        projectId: step.projectId,
        phaseStepId: step.id,
        departments: [step.owningDepartment, step.secondaryDepartment],
        hoursAgo: 4,
      },
    ];
  }

  return ready.map((block, i) => {
      const step = block.blockedPhaseStep!;
      const count = block.tasks.length;
      return {
        type: "block_ready",
        message: `${count === 1 ? "The blocked-work task" : `All ${count} blocked-work tasks`} on ${
          block.project.name
        } ${count === 1 ? "is" : "are"} done — ${step.stepCode} ${step.stepName} is ready to resume`,
        projectId: block.project.id,
        phaseStepId: step.id,
        departments: [step.owningDepartment, step.secondaryDepartment],
        hoursAgo: 4 + i * 30,
      };
    });
}

/** Items and steps that really did fail QC → qc_failed. */
async function qcFailedExamples(itemLimit: number): Promise<DemoNotification[]> {
  const items = await prisma.procurementItem.findMany({
    where: { qcPassed: false },
    include: { project: { select: { id: true, name: true } } },
    take: itemLimit,
  });
  const steps = await prisma.phaseStep.findMany({
    where: { qcPassed: false },
    include: { project: { select: { id: true, name: true } } },
    take: 1,
  });

  const out: DemoNotification[] = items.map((item, i) => ({
    type: "qc_failed",
    message: `${ITEM_TYPE_LABEL[item.itemType] ?? item.itemType} failed material QC on ${item.project.name}${
      item.actionPlanAt ? ` — action plan due ${formatShortDate(item.actionPlanAt)}` : ""
    }`,
    projectId: item.projectId,
    departments: ["purchase"],
    hoursAgo: 6 + i * 40,
    read: i > 0,
  }));

  for (const step of steps) {
    out.push({
      type: "qc_failed",
      message: `${step.stepCode} ${step.stepName} failed on ${step.project.name}${
        step.actionPlanAt ? ` — action plan due ${formatShortDate(step.actionPlanAt)}` : ""
      }`,
      projectId: step.projectId,
      phaseStepId: step.id,
      departments: [step.owningDepartment, step.secondaryDepartment],
      hoursAgo: 20,
    });
  }
  return out;
}

const STAGE_DEPARTMENTS: Record<string, Department[]> = {
  "Requirement created": ["design_engineer"],
  "Quote created": ["purchase"],
  "Payment done": ["accounts", "purchase"],
  "Order confirmed": ["purchase"],
  "Material despatch": ["purchase"],
  "Arrived for powder coating": ["purchase"],
  "Actual arrival": ["purchase"],
  "QC checked": ["purchase"],
};

/** Real overdue procurement/Glass PO stages, found the same way the cron finds them. */
async function procurementOverdueExamples(limit: number): Promise<DemoNotification[]> {
  const projects = await prisma.project.findMany({
    where: { currentPhase: { in: ["phase_2", "phase_3"] } },
    select: {
      id: true,
      name: true,
      phaseSteps: { select: { stepCode: true, plannedEndDate: true, actualEndDate: true, delayCategory: true } },
      procurementItems: {
        select: {
          itemType: true,
          requirementCreatedAt: true,
          quoteCreatedAt: true,
          paymentSettledAt: true,
          actualArrivalDate: true,
          qcCheckedAt: true,
          planAnchorOverride: true,
          requirementPlannedOverride: true,
          quotePlannedOverride: true,
          paymentPlannedOverride: true,
          orderPlannedOverride: true,
          arrivalPlannedOverride: true,
          qcPlannedOverride: true,
          orderConfirmedAt: true,
          materialDespatchAt: true,
          materialDespatchPlannedOverride: true,
          arrivedForPowderCoatingAt: true,
          arrivedForPowderCoatingPlannedOverride: true,
        },
      },
      glassPurchaseOrder: {
        select: {
          requirementCreatedAt: true,
          requirementPlannedDate: true,
          quoteCreatedAt: true,
          quotePlannedDate: true,
          paymentSettledAt: true,
          paymentPlannedDate: true,
          orderConfirmedAt: true,
          orderPlannedDate: true,
          actualArrivalDate: true,
          arrivalPlannedDate: true,
          qcCheckedAt: true,
          qcPlannedDate: true,
        },
      },
    },
    take: 40,
  });

  const out: DemoNotification[] = [];
  for (const project of projects) {
    if (out.length >= limit) break;
    const oneD = project.phaseSteps.find((s) => s.stepCode === "1D");
    const items = withLiveExpectedArrivalDates(project.procurementItems, oneD);
    const reasons = getProjectDelayReasons([], items, project.glassPurchaseOrder);

    for (const reason of reasons) {
      if (out.length >= limit || reason.kind === "step") continue;
      const label =
        reason.kind === "item"
          ? `${ITEM_TYPE_LABEL[reason.itemType] ?? reason.itemType} — ${reason.stageLabel}`
          : `Glass PO — ${reason.stageLabel}`;
      out.push({
        type: reason.kind === "item" ? "procurement_overdue" : "glass_po_overdue",
        message: `${label} on ${project.name} is overdue — was due ${formatShortDate(reason.plannedDate)}`,
        projectId: project.id,
        departments: STAGE_DEPARTMENTS[reason.stageLabel] ?? ["purchase"],
        hoursAgo: 1 + out.length * 34,
        read: out.length % 3 === 0,
      });
    }
  }
  return out;
}

/** 3C1 with nobody lined up → contractor_overdue. */
async function contractorExamples(limit: number): Promise<DemoNotification[]> {
  const steps = await prisma.phaseStep.findMany({
    where: { stepCode: "3C1", status: { not: "completed" }, contractorId: null },
    include: { project: { select: { id: true, name: true } } },
    take: 20,
  });
  const sections = await prisma.procurementItem.findMany({
    where: { projectId: { in: steps.map((s) => s.projectId) }, itemType: "section" },
    select: { projectId: true, requirementCreatedAt: true },
  });
  const byProject = new Map(sections.map((s) => [s.projectId, s.requirementCreatedAt]));

  return steps
    .filter((s) => byProject.get(s.projectId))
    .slice(0, limit)
    .map((step, i) => ({
      type: "contractor_overdue",
      message: `${step.stepCode} ${step.stepName} on ${step.project.name} still has no contractor — was due ${formatShortDate(
        byProject.get(step.projectId)!
      )}`,
      projectId: step.projectId,
      phaseStepId: step.id,
      departments: [step.owningDepartment, step.secondaryDepartment],
      hoursAgo: 30 + i * 48,
    }));
}

/** A finished project whose website review nobody has answered → website_review_due. */
async function websiteReviewExamples(limit: number): Promise<DemoNotification[]> {
  const projects = await prisma.project.findMany({
    where: { websiteReviewAsked: null, phaseSteps: { some: { stepCode: "3E", actualEndDate: { not: null } } } },
    select: { id: true, name: true, phaseSteps: { where: { stepCode: "3E" }, select: { actualEndDate: true } } },
    take: limit,
  });

  if (projects.length === 0) {
    // No project here has finished 3E yet — illustrative row against a real Phase 3 project.
    const project = await prisma.project.findFirst({
      where: { currentPhase: "phase_3" },
      select: { id: true, name: true },
    });
    if (!project) return [];
    return [
      {
        type: "website_review_due",
        message: `Website review for ${project.name} is due — planned ${formatShortDate(addDays(new Date(), -2))}`,
        projectId: project.id,
        departments: ["hr_admin"],
        hoursAgo: 8,
      },
    ];
  }

  return projects.map((project, i) => ({
    type: "website_review_due",
    message: `Website review for ${project.name} is due — planned ${formatShortDate(
      addDays(project.phaseSteps[0].actualEndDate!, 1)
    )}`,
    projectId: project.id,
    departments: ["hr_admin"],
    hoursAgo: 8 + i * 24,
  }));
}

async function seed() {
  const examples = [
    ...(await blockedStepExamples(3)),
    ...(await overdueStepExamples(3)),
    ...(await blockReadyExamples(1)),
    ...(await qcFailedExamples(2)),
    ...(await procurementOverdueExamples(3)),
    ...(await contractorExamples(2)),
    ...(await websiteReviewExamples(1)),
  ];

  if (examples.length === 0) {
    console.log("Nothing to seed — this database has no blocked steps, overdue work or QC failures.");
    return;
  }

  let rows = 0;
  for (const [i, example] of examples.entries()) {
    const recipients = await resolveRecipients(example.departments);
    if (recipients.length === 0) continue;

    const createdAt = hoursAgo(example.hoursAgo);
    const result = await prisma.notification.createMany({
      data: recipients.map((userId) => ({
        userId,
        type: example.type,
        message: example.message,
        projectId: example.projectId,
        phaseStepId: example.phaseStepId ?? null,
        dedupeKey: `${DEMO_KEY_PREFIX}${i}`,
        createdAt,
        readAt: example.read ? createdAt : null,
      })),
      skipDuplicates: true,
    });
    rows += result.count;
    console.log(`  ${example.type.padEnd(20)} → ${String(result.count).padStart(2)} recipients  ${example.message}`);
  }

  console.log(`\nSeeded ${rows} notification row(s) across ${examples.length} example(s).`);
  console.log("Undo with: npx tsx -r dotenv/config scripts/seed-demo-notifications.ts undo");
}

async function undo() {
  const removed = await prisma.notification.deleteMany({ where: { dedupeKey: { startsWith: DEMO_KEY_PREFIX } } });
  console.log(`Removed ${removed.count} seeded notification row(s).`);
}

const run = process.argv[2] === "undo" ? undo : seed;
run().finally(() => prisma.$disconnect());
