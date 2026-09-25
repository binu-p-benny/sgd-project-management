import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus } from "@/lib/step-actions";
import {
  notifyBlockedWorkReady,
  notifyGlassQcFailed,
  notifyProcurementQcFailed,
  notifyStepQcFailed,
} from "@/lib/notify-events";
import {
  createTestProject,
  createTestProjectDayOne,
  ensureTestUsers,
  getStep,
  prisma,
  cleanupTestProjects,
} from "../helpers/db";
import { advanceThroughPhase1, advanceThroughPhase2, patchProcurementItem } from "../helpers/scenarios";
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

describe("step_blocked", () => {
  it("notifies the step's departments and the admin ones, but not whoever did the blocking", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A"); // owning: hr_admin, secondary: project_engineer

    await updateStepStatus(oneA.id, "blocked", users.hr_admin, { blockedReason: "site_not_ready" });

    const notifications = await notificationsFor(project.id, "step_blocked");
    const recipientIds = notifications.map((n) => n.userId).sort();
    // hr_admin did the blocking, so they're left out even though they own the step.
    expect(recipientIds).toEqual([users.project_engineer, users.owner_admin, users.operations_manager].sort());
    expect(notifications[0].message).toContain("1A");
    expect(notifications[0].message).toContain("Site not ready");
    expect(notifications.every((n) => n.phaseStepId === oneA.id)).toBe(true);
  });

  it("says 'blocked' in Phase 1 and 'temporarily blocked' after it, matching the badges", async () => {
    const phase1 = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(phase1.id, "1A");
    await updateStepStatus(oneA.id, "blocked", users.owner_admin, { blockedReason: "client_hold" });
    const phase1Notification = (await notificationsFor(phase1.id, "step_blocked"))[0];
    expect(phase1Notification.message).toContain("is blocked —");
    expect(phase1Notification.message).not.toContain("temporarily");

    const phase3 = await projectAtPhase3();
    const threeC1 = await getStep(phase3.id, "3C1");
    await updateStepStatus(threeC1.id, "blocked", users.owner_admin, { blockedReason: "section_damage" });
    const phase3Notification = (await notificationsFor(phase3.id, "step_blocked"))[0];
    expect(phase3Notification.message).toContain("is temporarily blocked —");
  });

  it("does not re-notify when an already-blocked step is saved again", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");

    await updateStepStatus(oneA.id, "blocked", users.owner_admin, { blockedReason: "site_not_ready" });
    const afterFirst = (await notificationsFor(project.id, "step_blocked")).length;
    await updateStepStatus(oneA.id, "blocked", users.owner_admin, { blockedReason: "client_hold" });

    expect((await notificationsFor(project.id, "step_blocked")).length).toBe(afterFirst);
  });
});

describe("block_ready", () => {
  async function blockedProjectWithTasks(taskCount: number) {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "blocked", users.owner_admin, { blockedReason: "site_not_ready" });

    const block = await prisma.workBlock.create({
      data: {
        projectId: project.id,
        label: "Blocked work",
        blockedPhaseStepId: oneA.id,
        tasks: {
          create: Array.from({ length: taskCount }, (_, i) => ({
            taskLabel: `Follow-up ${i + 1}`,
            department: "project_engineer" as Department,
            plannedDate: new Date(),
          })),
        },
      },
      include: { tasks: true },
    });
    return { project, step: oneA, block };
  }

  it("stays quiet while any task is still outstanding", async () => {
    const { project, block } = await blockedProjectWithTasks(2);
    await prisma.workTask.update({ where: { id: block.tasks[0].id }, data: { actualDate: new Date() } });

    expect(await notifyBlockedWorkReady(block.id)).toBe(0);
    expect(await notificationsFor(project.id, "block_ready")).toHaveLength(0);
  });

  it("notifies the blocked step's departments once every task is done, and not twice", async () => {
    const { project, step, block } = await blockedProjectWithTasks(2);
    for (const task of block.tasks) {
      await prisma.workTask.update({ where: { id: task.id }, data: { actualDate: new Date() } });
    }

    expect(await notifyBlockedWorkReady(block.id)).toBeGreaterThan(0);
    const notifications = await notificationsFor(project.id, "block_ready");
    expect(notifications.map((n) => n.userId).sort()).toEqual(
      [users.hr_admin, users.project_engineer, users.owner_admin, users.operations_manager].sort()
    );
    expect(notifications[0].message).toContain("2 blocked-work tasks");
    expect(notifications[0].message).toContain("ready to resume");
    expect(notifications[0].phaseStepId).toBe(step.id);

    // Dedupe key is per block + task count, so a repeat run adds nothing.
    expect(await notifyBlockedWorkReady(block.id)).toBe(0);
    expect(await notificationsFor(project.id, "block_ready")).toHaveLength(notifications.length);
  });

  it("announces again once a further task is added and completed", async () => {
    const { project, block } = await blockedProjectWithTasks(1);
    await prisma.workTask.update({ where: { id: block.tasks[0].id }, data: { actualDate: new Date() } });
    await notifyBlockedWorkReady(block.id);
    const afterFirst = (await notificationsFor(project.id, "block_ready")).length;
    expect(afterFirst).toBeGreaterThan(0);

    const extra = await prisma.workTask.create({
      data: {
        workBlockId: block.id,
        taskLabel: "One more thing",
        department: "purchase",
        plannedDate: new Date(),
        actualDate: new Date(),
      },
    });
    expect(extra.actualDate).not.toBeNull();

    await notifyBlockedWorkReady(block.id);
    expect((await notificationsFor(project.id, "block_ready")).length).toBeGreaterThan(afterFirst);
  });

  it("stays quiet for a block that isn't tied to a blocked step", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const block = await prisma.workBlock.create({
      data: {
        projectId: project.id,
        label: "Additional works",
        tasks: { create: [{ taskLabel: "Extra", department: "purchase", plannedDate: new Date(), actualDate: new Date() }] },
      },
    });

    expect(await notifyBlockedWorkReady(block.id)).toBe(0);
  });
});

describe("qc_failed", () => {
  it("notifies purchase and the admins when a procurement item fails QC, once per check", async () => {
    const project = await createTestProject({});
    await advanceThroughPhase1(project.id, users, "emergency");
    await patchProcurementItem(project.id, "section", users.purchase, {
      requirementCreatedAt: daysAgo(10),
      actualArrivalDate: daysAgo(1),
      qcCheckedAt: new Date(),
      qcPassed: false,
    });
    const item = await prisma.procurementItem.findFirstOrThrow({
      where: { projectId: project.id, itemType: "section" },
    });

    expect(await notifyProcurementQcFailed(item.id, users.purchase)).toBeGreaterThan(0);
    const notifications = await notificationsFor(project.id, "qc_failed");
    // purchase raised it, so the row goes to the three admin departments only.
    expect(notifications.map((n) => n.userId).sort()).toEqual(
      [users.owner_admin, users.hr_admin, users.operations_manager].sort()
    );
    expect(notifications[0].message).toContain("Section failed material QC");

    expect(await notifyProcurementQcFailed(item.id, users.purchase)).toBe(0);
  });

  it("notifies again after a fresh check fails", async () => {
    const project = await createTestProject({});
    await advanceThroughPhase1(project.id, users, "emergency");
    await patchProcurementItem(project.id, "hardware", users.purchase, {
      requirementCreatedAt: daysAgo(10),
      qcCheckedAt: daysAgo(2),
      qcPassed: false,
    });
    const item = await prisma.procurementItem.findFirstOrThrow({
      where: { projectId: project.id, itemType: "hardware" },
    });
    await notifyProcurementQcFailed(item.id, users.purchase);
    const afterFirst = (await notificationsFor(project.id, "qc_failed")).length;

    await prisma.procurementItem.update({ where: { id: item.id }, data: { qcCheckedAt: new Date() } });
    await notifyProcurementQcFailed(item.id, users.purchase);

    expect((await notificationsFor(project.id, "qc_failed")).length).toBeGreaterThan(afterFirst);
  });

  it("stays quiet for an item that passed", async () => {
    const project = await createTestProject({});
    await advanceThroughPhase1(project.id, users, "emergency");
    await patchProcurementItem(project.id, "gasket", users.purchase, {
      requirementCreatedAt: daysAgo(10),
      qcCheckedAt: new Date(),
    });
    const item = await prisma.procurementItem.findFirstOrThrow({
      where: { projectId: project.id, itemType: "gasket" },
    });

    expect(await notifyProcurementQcFailed(item.id, users.purchase)).toBe(0);
  });

  it("covers the Glass PO and 3E on the same rule", async () => {
    const project = await projectAtPhase3();

    const glassPO = await prisma.glassPurchaseOrder.findUniqueOrThrow({ where: { projectId: project.id } });
    await prisma.glassPurchaseOrder.update({
      where: { id: glassPO.id },
      data: { qcCheckedAt: new Date(), qcPassed: false },
    });
    expect(await notifyGlassQcFailed(glassPO.id, users.purchase)).toBeGreaterThan(0);

    const threeE = await getStep(project.id, "3E");
    await prisma.phaseStep.update({
      where: { id: threeE.id },
      data: { qcCheckedAt: new Date(), qcPassed: false, actionPlanAt: new Date() },
    });
    expect(await notifyStepQcFailed(threeE.id, users.project_engineer)).toBeGreaterThan(0);

    const messages = (await notificationsFor(project.id, "qc_failed")).map((n) => n.message);
    expect(messages.some((m) => m.includes("Glass PO failed QC"))).toBe(true);
    expect(messages.some((m) => m.includes("3E Final QC on site failed on") && m.includes("action plan due"))).toBe(
      true
    );
  });
});

