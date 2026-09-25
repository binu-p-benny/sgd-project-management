import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  notifyContractorNotAssigned,
  notifyOverdueProcurement,
  notifyWebsiteReviewDue,
} from "@/lib/notify-cron";
import {
  createTestProject,
  createTestProjectDayOne,
  ensureTestUsers,
  getStep,
  prisma,
  cleanupTestProjects,
} from "../helpers/db";
import { advanceThroughPhase1, advanceThroughPhase2 } from "../helpers/scenarios";
import type { Department } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function notificationsFor(projectId: string, type: string) {
  return prisma.notification.findMany({ where: { projectId, type } });
}

async function projectAtPhase3() {
  const project = await createTestProject({});
  await advanceThroughPhase1(project.id, users, "emergency");
  await advanceThroughPhase2(project.id, users);
  return project;
}

describe("procurement_overdue", () => {
  it("notifies the stage's own department when a procurement stage is past its planned date", async () => {
    const project = await createTestProject({});
    await advanceThroughPhase1(project.id, users, "emergency");
    const item = await prisma.procurementItem.findFirstOrThrow({
      where: { projectId: project.id, itemType: "section" },
    });
    // Requirement created is design_engineer's stage — overdue with nothing recorded against it.
    await prisma.procurementItem.update({
      where: { id: item.id },
      data: { requirementPlannedOverride: daysAgo(4) },
    });

    await notifyOverdueProcurement();

    const notifications = await notificationsFor(project.id, "procurement_overdue");
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.map((n) => n.userId).sort()).toEqual(
      [users.design_engineer, users.owner_admin, users.hr_admin, users.operations_manager].sort()
    );
    expect(notifications[0].message).toContain("Section — Requirement created");
    expect(notifications[0].message).toContain("is overdue");

    // Same planned date on a second run — same key, nothing new.
    await notifyOverdueProcurement();
    expect((await notificationsFor(project.id, "procurement_overdue")).length).toBe(notifications.length);
  });

  it("notifies again when the planned date moves and is still overdue", async () => {
    const project = await createTestProject({});
    await advanceThroughPhase1(project.id, users, "emergency");
    const item = await prisma.procurementItem.findFirstOrThrow({
      where: { projectId: project.id, itemType: "hardware" },
    });
    await prisma.procurementItem.update({
      where: { id: item.id },
      data: { requirementPlannedOverride: daysAgo(6) },
    });
    await notifyOverdueProcurement();
    const afterFirst = (await notificationsFor(project.id, "procurement_overdue")).length;

    await prisma.procurementItem.update({
      where: { id: item.id },
      data: { requirementPlannedOverride: daysAgo(3) },
    });
    await notifyOverdueProcurement();

    expect((await notificationsFor(project.id, "procurement_overdue")).length).toBeGreaterThan(afterFirst);
  });

  it("leaves overdue phase steps to notifyOverdueSteps", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await prisma.phaseStep.update({ where: { id: oneA.id }, data: { plannedEndDate: daysAgo(5) } });

    await notifyOverdueProcurement();

    expect(await notificationsFor(project.id, "step_overdue")).toHaveLength(0);
  });
});

describe("contractor_overdue", () => {
  it("notifies when 3C1 has no contractor past the Section requirement date, once per date", async () => {
    const project = await projectAtPhase3();
    const item = await prisma.procurementItem.findFirstOrThrow({
      where: { projectId: project.id, itemType: "section" },
    });
    await prisma.procurementItem.update({
      where: { id: item.id },
      data: { requirementCreatedAt: daysAgo(5) },
    });

    await notifyContractorNotAssigned();

    const notifications = await notificationsFor(project.id, "contractor_overdue");
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications[0].message).toContain("3C1");
    expect(notifications[0].message).toContain("no contractor");

    await notifyContractorNotAssigned();
    expect((await notificationsFor(project.id, "contractor_overdue")).length).toBe(notifications.length);
  });

  it("stays quiet once a contractor is assigned", async () => {
    const project = await projectAtPhase3();
    const item = await prisma.procurementItem.findFirstOrThrow({
      where: { projectId: project.id, itemType: "section" },
    });
    await prisma.procurementItem.update({ where: { id: item.id }, data: { requirementCreatedAt: daysAgo(5) } });

    const contractor = await prisma.contractor.create({
      data: { name: `__TEST__ contractor ${Date.now()}`, phone: "0000000000", address: "Test address" },
    });
    const threeC1 = await getStep(project.id, "3C1");
    await prisma.phaseStep.update({ where: { id: threeC1.id }, data: { contractorId: contractor.id } });

    await notifyContractorNotAssigned();

    expect(await notificationsFor(project.id, "contractor_overdue")).toHaveLength(0);
    await prisma.contractor.delete({ where: { id: contractor.id } });
  });
});

describe("website_review_due", () => {
  it("notifies HR once the review has opened, and reminds weekly while it stays unanswered", async () => {
    const project = await projectAtPhase3();
    const threeE = await getStep(project.id, "3E");
    await prisma.phaseStep.update({ where: { id: threeE.id }, data: { actualEndDate: daysAgo(3) } });

    await notifyWebsiteReviewDue();
    const notifications = await notificationsFor(project.id, "website_review_due");
    expect(notifications.map((n) => n.userId).sort()).toEqual(
      [users.hr_admin, users.owner_admin, users.operations_manager].sort()
    );
    expect(notifications[0].message).toContain("Website review");

    await notifyWebsiteReviewDue();
    expect((await notificationsFor(project.id, "website_review_due")).length).toBe(notifications.length);

    // A week further on, the same review earns a fresh reminder.
    await prisma.phaseStep.update({ where: { id: threeE.id }, data: { actualEndDate: daysAgo(11) } });
    await notifyWebsiteReviewDue();
    const reminded = await notificationsFor(project.id, "website_review_due");
    expect(reminded.length).toBeGreaterThan(notifications.length);
    expect(reminded.some((n) => n.message.includes("still unanswered"))).toBe(true);
  });

  it("stays quiet before the review opens and once it's answered", async () => {
    const early = await projectAtPhase3();
    const earlyThreeE = await getStep(early.id, "3E");
    await prisma.phaseStep.update({ where: { id: earlyThreeE.id }, data: { actualEndDate: new Date() } });
    await notifyWebsiteReviewDue();
    expect(await notificationsFor(early.id, "website_review_due")).toHaveLength(0);

    const answered = await projectAtPhase3();
    const answeredThreeE = await getStep(answered.id, "3E");
    await prisma.phaseStep.update({ where: { id: answeredThreeE.id }, data: { actualEndDate: daysAgo(4) } });
    await prisma.project.update({ where: { id: answered.id }, data: { websiteReviewAsked: true } });
    await notifyWebsiteReviewDue();
    expect(await notificationsFor(answered.id, "website_review_due")).toHaveLength(0);
  });
});
