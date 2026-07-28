import { PrismaClient, type BlockedReason, type Department, type GlassType } from "@prisma/client";
import { hashPassword } from "@/lib/auth";
import {
  buildPhase1Steps,
  buildPhase2Steps,
  buildPhase3Steps,
  computePlannedDates,
  deriveVisitDurationDays,
} from "@/lib/step-template";
import { computeExpectedArrivalDate } from "@/lib/procurement";

export const prisma = new PrismaClient();

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const DEMO_USERS: { name: string; email: string; department: Department }[] = [
  { name: "Asha Rao", email: "hr@sgd.demo", department: "hr_admin" },
  { name: "Vikram Nair", email: "engineer@sgd.demo", department: "project_engineer" },
  { name: "Meera Iyer", email: "design@sgd.demo", department: "design_engineer" },
  { name: "Suresh Pillai", email: "purchase@sgd.demo", department: "purchase" },
  { name: "Lakshmi Menon", email: "accounts@sgd.demo", department: "accounts" },
  { name: "Owner Admin", email: "owner@sgd.demo", department: "owner_admin" },
];

export async function seedUsers() {
  const passwordHash = await hashPassword("password123");
  const users: Record<string, { id: string }> = {};

  for (const u of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { name: u.name, email: u.email, department: u.department, passwordHash },
    });
    users[u.department] = user;
  }

  return users;
}

export interface ProjectSeed {
  name: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  finalCost: number;
  glassType: GlassType;
  createdDaysAgo: number;
  /** How far to advance the project's steps for this demo scenario. */
  scenario:
    | "just_started"
    | "site_visit_blocked"
    | "phase1_in_progress"
    | "phase2_procuring"
    | "phase2_blocked_vendor"
    | "phase3_installing"
    | "completed";
  paymentStatus: "pending" | "partial" | "received";
  amountReceived: number;
}

const PROJECT_SEEDS: ProjectSeed[] = [
  {
    name: "Shalimar Residency Windows",
    clientName: "Rakesh Sharma",
    clientPhone: "9876500001",
    clientAddress: "Plot 12, Shalimar Residency, Pune",
    finalCost: 1250000,
    glassType: "normal",
    createdDaysAgo: 1,
    scenario: "just_started",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Green Valley Apartments Glazing",
    clientName: "Priya Menon",
    clientPhone: "9876500002",
    clientAddress: "Tower B, Green Valley Apartments, Kochi",
    finalCost: 980000,
    glassType: "normal",
    createdDaysAgo: 5,
    scenario: "site_visit_blocked",
    paymentStatus: "pending",
    amountReceived: 0,
  },
  {
    name: "Whitefield Villa Facade",
    clientName: "Anand Gupta",
    clientPhone: "9876500003",
    clientAddress: "Villa 7, Whitefield Enclave, Bengaluru",
    finalCost: 1450000,
    glassType: "laminated",
    createdDaysAgo: 10,
    scenario: "phase1_in_progress",
    paymentStatus: "partial",
    amountReceived: 400000,
  },
  {
    name: "Coastal Heights Balcony Glazing",
    clientName: "Divya Nambiar",
    clientPhone: "9876500004",
    clientAddress: "Flat 402, Coastal Heights, Chennai",
    finalCost: 1100000,
    glassType: "normal",
    createdDaysAgo: 25,
    scenario: "phase2_procuring",
    paymentStatus: "partial",
    amountReceived: 550000,
  },
  {
    name: "Lakeside Office Curtain Wall",
    clientName: "Ferro Constructions Pvt Ltd",
    clientPhone: "9876500005",
    clientAddress: "Lakeside Business Park, Hyderabad",
    finalCost: 1500000,
    glassType: "laminated",
    createdDaysAgo: 35,
    scenario: "phase2_blocked_vendor",
    paymentStatus: "partial",
    amountReceived: 750000,
  },
  {
    name: "Palm Grove Bungalow Windows",
    clientName: "Sunita Reddy",
    clientPhone: "9876500006",
    clientAddress: "Palm Grove Layout, Vizag",
    finalCost: 1050000,
    glassType: "normal",
    createdDaysAgo: 50,
    scenario: "phase3_installing",
    paymentStatus: "partial",
    amountReceived: 900000,
  },
  {
    name: "Riverside Duplex Glazing",
    clientName: "Karthik Subramaniam",
    clientPhone: "9876500007",
    clientAddress: "Riverside Colony, Coimbatore",
    finalCost: 1350000,
    glassType: "normal",
    createdDaysAgo: 70,
    scenario: "completed",
    paymentStatus: "received",
    amountReceived: 1350000,
  },
];

export async function seedProject(
  seed: ProjectSeed,
  users: Record<string, { id: string }>
) {
  const createdAt = addDays(new Date(), -seed.createdDaysAgo);

  const project = await prisma.project.create({
    data: {
      name: seed.name,
      clientName: seed.clientName,
      clientPhone: seed.clientPhone,
      clientAddress: seed.clientAddress,
      finalCost: seed.finalCost,
      amountReceived: seed.amountReceived,
      paymentStatus: seed.paymentStatus,
      glassType: seed.glassType,
      plannedStartDate: createdAt,
      currentPhase: "phase_1",
      overallStatus: "on_track",
      createdAt,
    },
  });

  const phase1 = buildPhase1Steps();
  const phase1Dates = computePlannedDates(phase1, createdAt);
  const stepRows = phase1.map((s) => ({
    projectId: project.id,
    phase: s.phase,
    stepCode: s.stepCode,
    stepName: s.stepName,
    owningDepartment: s.owningDepartment,
    secondaryDepartment: s.secondaryDepartment,
    plannedDurationDays: s.plannedDurationDays,
    dependsOn: s.dependsOn,
    plannedStartDate: phase1Dates.get(s.stepCode)!.plannedStartDate,
    plannedEndDate: phase1Dates.get(s.stepCode)!.plannedEndDate,
  }));
  await prisma.phaseStep.createMany({ data: stepRows });

  const engineer = users["project_engineer"];
  const designer = users["design_engineer"];
  const accountant = users["accounts"];
  const purchaser = users["purchase"];
  const hr = users["hr_admin"];

  async function completeStep(stepCode: string, actorId: string, completedAt: Date) {
    const step = await prisma.phaseStep.findFirstOrThrow({
      where: { projectId: project.id, stepCode },
    });
    // plannedStartDate is a stand-in for a real actualStartDate this demo data never
    // recorded — but the hardcoded d(N) completion offsets in each scenario aren't
    // guaranteed to stay after whatever the scheduler computed for plannedStartDate,
    // so clamp rather than risk actualStartDate landing after actualEndDate.
    const actualStartDate =
      step.plannedStartDate && step.plannedStartDate < completedAt ? step.plannedStartDate : completedAt;
    await prisma.phaseStep.update({
      where: { id: step.id },
      data: {
        status: "completed",
        actualStartDate,
        actualEndDate: completedAt,
      },
    });
    await prisma.stepStatusLog.create({
      data: {
        phaseStepId: step.id,
        changedByUserId: actorId,
        oldStatus: step.status,
        newStatus: "completed",
        changedAt: completedAt,
      },
    });
  }

  async function startStep(stepCode: string, actorId: string, startedAt: Date) {
    const step = await prisma.phaseStep.findFirstOrThrow({
      where: { projectId: project.id, stepCode },
    });
    await prisma.phaseStep.update({
      where: { id: step.id },
      data: { status: "in_progress", actualStartDate: startedAt },
    });
    await prisma.stepStatusLog.create({
      data: {
        phaseStepId: step.id,
        changedByUserId: actorId,
        oldStatus: step.status,
        newStatus: "in_progress",
        changedAt: startedAt,
      },
    });
  }

  async function blockStep(
    stepCode: string,
    actorId: string,
    blockedAt: Date,
    reason: BlockedReason,
    note?: string
  ) {
    const step = await prisma.phaseStep.findFirstOrThrow({
      where: { projectId: project.id, stepCode },
    });
    await prisma.phaseStep.update({
      where: { id: step.id },
      data: { status: "blocked", blockedReason: reason, blockedNote: note, updatedAt: blockedAt },
    });
    await prisma.stepStatusLog.create({
      data: {
        phaseStepId: step.id,
        changedByUserId: actorId,
        oldStatus: step.status,
        newStatus: "blocked",
        reason: note ?? reason,
        changedAt: blockedAt,
      },
    });
  }

  async function seedPhase2(anchor: Date) {
    const oneD = await prisma.phaseStep.findFirstOrThrow({
      where: { projectId: project.id, stepCode: "1D" },
    });
    const phase2 = buildPhase2Steps();
    const dates = computePlannedDates(phase2, anchor, new Map([["1D", oneD.actualEndDate ?? anchor]]));
    await prisma.phaseStep.createMany({
      data: phase2.map((s) => ({
        projectId: project.id,
        phase: s.phase,
        stepCode: s.stepCode,
        stepName: s.stepName,
        owningDepartment: s.owningDepartment,
        secondaryDepartment: s.secondaryDepartment,
        plannedDurationDays: s.plannedDurationDays,
        dependsOn: s.dependsOn,
        plannedStartDate: dates.get(s.stepCode)!.plannedStartDate,
        plannedEndDate: dates.get(s.stepCode)!.plannedEndDate,
      })),
    });
    await prisma.project.update({ where: { id: project.id }, data: { currentPhase: "phase_2" } });
  }

  async function seedPhase3(anchor: Date) {
    const twoF = await prisma.phaseStep.findFirstOrThrow({
      where: { projectId: project.id, stepCode: "2F" },
    });
    const phase3 = buildPhase3Steps(seed.glassType);
    const dates = computePlannedDates(phase3, anchor, new Map([["2F", twoF.actualEndDate ?? anchor]]));
    await prisma.phaseStep.createMany({
      data: phase3.map((s) => ({
        projectId: project.id,
        phase: s.phase,
        stepCode: s.stepCode,
        stepName: s.stepName,
        owningDepartment: s.owningDepartment,
        secondaryDepartment: s.secondaryDepartment,
        plannedDurationDays: s.plannedDurationDays,
        dependsOn: s.dependsOn,
        plannedStartDate: dates.get(s.stepCode)!.plannedStartDate,
        plannedEndDate: dates.get(s.stepCode)!.plannedEndDate,
      })),
    });
    await prisma.project.update({ where: { id: project.id }, data: { currentPhase: "phase_3" } });
  }

  async function seedProcurementItems(anchor: Date) {
    const types = ["section", "hardware", "gasket"] as const;
    for (const itemType of types) {
      await prisma.procurementItem.create({
        data: {
          projectId: project.id,
          itemType,
          requirementCreatedAt: anchor,
          expectedArrivalDate: computeExpectedArrivalDate(itemType, anchor),
        },
      });
    }
  }

  const d = (offset: number) => addDays(createdAt, offset);

  switch (seed.scenario) {
    case "just_started": {
      await startStep("1A", hr.id, d(0));
      break;
    }

    case "site_visit_blocked": {
      await completeStep("1A", hr.id, d(1));
      await prisma.project.update({
        where: { id: project.id },
        data: { visitUrgency: "site_not_ready", overallStatus: "blocked" },
      });
      await blockStep("1B", engineer.id, d(1), "site_not_ready", "Client still finishing interior work");
      break;
    }

    case "phase1_in_progress": {
      await completeStep("1A", hr.id, d(1));
      await prisma.project.update({ where: { id: project.id }, data: { visitUrgency: "hot" } });
      const visitDuration = deriveVisitDurationDays("hot")!;
      const visitStep = await prisma.phaseStep.findFirstOrThrow({
        where: { projectId: project.id, stepCode: "1B" },
      });
      await prisma.phaseStep.update({
        where: { id: visitStep.id },
        data: { plannedDurationDays: visitDuration, plannedEndDate: d(1 + visitDuration) },
      });
      await completeStep("1B", engineer.id, d(4));
      await startStep("1C", designer.id, d(4));
      break;
    }

    case "phase2_procuring": {
      await completeStep("1A", hr.id, d(1));
      await prisma.project.update({ where: { id: project.id }, data: { visitUrgency: "cold" } });
      await completeStep("1B", engineer.id, d(16));
      await completeStep("1C", designer.id, d(18));
      await completeStep("1D", accountant.id, d(20));
      await seedPhase2(d(20));
      await completeStep("2A", designer.id, d(21));
      await seedProcurementItems(d(21));
      await startStep("2D1", purchaser.id, d(21));
      await startStep("2D2", designer.id, d(21));
      break;
    }

    case "phase2_blocked_vendor": {
      await completeStep("1A", hr.id, d(1));
      await prisma.project.update({ where: { id: project.id }, data: { visitUrgency: "hot" } });
      await completeStep("1B", engineer.id, d(6));
      await completeStep("1C", designer.id, d(8));
      await completeStep("1D", accountant.id, d(10));
      await seedPhase2(d(10));
      await completeStep("2A", designer.id, d(11));
      await seedProcurementItems(d(11));
      // 2D1 is derived — it's "in progress" because hardware/gasket arrived but section
      // (delayed by a vendor issue) hasn't, not because anyone set its status directly.
      await startStep("2D1", purchaser.id, d(11));
      const sectionItem = await prisma.procurementItem.findFirstOrThrow({
        where: { projectId: project.id, itemType: "section" },
      });
      await prisma.procurementItem.update({
        where: { id: sectionItem.id },
        data: { quoteCreatedAt: d(14), orderConfirmedAt: d(16) },
      });
      const hardwareItem = await prisma.procurementItem.findFirstOrThrow({
        where: { projectId: project.id, itemType: "hardware" },
      });
      await prisma.procurementItem.update({
        where: { id: hardwareItem.id },
        data: {
          quoteCreatedAt: d(25),
          orderConfirmedAt: d(26),
          actualArrivalDate: d(31),
          qcChecked: true,
          qcCheckedAt: d(32),
          qcCheckedBy: purchaser.id,
        },
      });
      const gasketItem = await prisma.procurementItem.findFirstOrThrow({
        where: { projectId: project.id, itemType: "gasket" },
      });
      await prisma.procurementItem.update({
        where: { id: gasketItem.id },
        data: {
          quoteCreatedAt: d(25),
          orderConfirmedAt: d(26),
          actualArrivalDate: d(31),
          qcChecked: true,
          qcCheckedAt: d(32),
          qcCheckedBy: purchaser.id,
        },
      });
      await startStep("2D2", designer.id, d(11));
      break;
    }

    case "phase3_installing": {
      await completeStep("1A", hr.id, d(1));
      await prisma.project.update({ where: { id: project.id }, data: { visitUrgency: "emergency" } });
      await completeStep("1B", engineer.id, d(3));
      await completeStep("1C", designer.id, d(5));
      await completeStep("1D", accountant.id, d(7));
      await seedPhase2(d(7));
      await completeStep("2A", designer.id, d(8));
      await seedProcurementItems(d(8));
      for (const itemType of ["section", "hardware", "gasket"] as const) {
        const item = await prisma.procurementItem.findFirstOrThrow({
          where: { projectId: project.id, itemType },
        });
        await prisma.procurementItem.update({
          where: { id: item.id },
          data: {
            quoteCreatedAt: d(11),
            orderConfirmedAt: d(13),
            actualArrivalDate: d(28),
            qcChecked: true,
            qcCheckedAt: d(29),
            qcCheckedBy: purchaser.id,
          },
        });
      }
      await completeStep("2D1", purchaser.id, d(28));
      await completeStep("2D2", designer.id, d(20));
      await completeStep("2F", purchaser.id, d(29));
      await seedPhase3(d(29));
      await startStep("3A", purchaser.id, d(29));
      await startStep("3C1", engineer.id, d(29));
      break;
    }

    case "completed": {
      await completeStep("1A", hr.id, d(1));
      await prisma.project.update({ where: { id: project.id }, data: { visitUrgency: "emergency" } });
      await completeStep("1B", engineer.id, d(3));
      await completeStep("1C", designer.id, d(5));
      await completeStep("1D", accountant.id, d(7));
      await seedPhase2(d(7));
      await completeStep("2A", designer.id, d(8));
      await seedProcurementItems(d(8));
      for (const itemType of ["section", "hardware", "gasket"] as const) {
        const item = await prisma.procurementItem.findFirstOrThrow({
          where: { projectId: project.id, itemType },
        });
        await prisma.procurementItem.update({
          where: { id: item.id },
          data: {
            quoteCreatedAt: d(11),
            orderConfirmedAt: d(13),
            actualArrivalDate: d(27),
            qcChecked: true,
            qcCheckedAt: d(28),
            qcCheckedBy: purchaser.id,
          },
        });
      }
      await completeStep("2D1", purchaser.id, d(27));
      await completeStep("2D2", designer.id, d(20));
      await completeStep("2F", purchaser.id, d(28));
      await seedPhase3(d(28));
      await completeStep("3A", purchaser.id, d(31));
      await completeStep("3B", purchaser.id, d(41));
      await completeStep("3C1", engineer.id, d(38));
      await completeStep("3C2", engineer.id, d(46));
      await completeStep("3E", engineer.id, d(52));
      await prisma.project.update({
        where: { id: project.id },
        data: {
          currentPhase: "completed",
          overallStatus: "completed",
          actualStartDate: createdAt,
          actualEndDate: d(52),
        },
      });
      break;
    }
  }
}

async function main() {
  console.log("Seeding users...");
  const users = await seedUsers();

  console.log("Seeding demo projects...");
  for (const seed of PROJECT_SEEDS) {
    await seedProject(seed, users);
    console.log(`  created "${seed.name}" (${seed.scenario})`);
  }

  console.log("Done.");
}

// Only auto-run the base seed when this file is executed directly (`prisma db seed` /
// `tsx prisma/seed.ts`) — not when another script imports its exports for reuse (e.g.
// seed-extra.ts, which adds more demo projects without re-running this file's own).
const isMainModule = process.argv[1]?.endsWith("seed.ts") || process.argv[1]?.endsWith("seed.js");
if (isMainModule) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
