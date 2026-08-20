import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { notifyOverdueSteps } from "@/lib/notify-overdue";
import { rescheduleProjectDates } from "@/lib/reschedule";
import { getMyTasks } from "@/lib/my-tasks";
import {
  createTestProjectDayOne,
  ensureTestUsers,
  getStep,
  prisma,
  cleanupTestProjects,
} from "../helpers/db";
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

async function backdateStep(stepId: string, plannedEndDate: Date) {
  await prisma.phaseStep.update({ where: { id: stepId }, data: { plannedEndDate, notifiedOverdueAt: null } });
}

describe("notifyOverdueSteps", () => {
  it("notifies the owning department, secondary department, and both admin departments — once each", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A"); // owning: hr_admin, secondary: project_engineer
    await backdateStep(oneA.id, daysAgo(2));

    const { notified } = await notifyOverdueSteps();
    expect(notified).toBeGreaterThanOrEqual(1);

    const notifications = await prisma.notification.findMany({ where: { phaseStepId: oneA.id } });
    const recipientIds = notifications.map((n) => n.userId).sort();
    // hr_admin is both 1A's owning department AND an admin department — must appear once, not twice.
    expect(recipientIds).toEqual(
      [users.hr_admin, users.project_engineer, users.owner_admin].sort()
    );
    expect(notifications.every((n) => n.projectId === project.id && n.type === "step_overdue")).toBe(true);
    expect(notifications[0].message).toContain("1A");
  });

  it("does not notify departments unrelated to the step", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await backdateStep(oneA.id, daysAgo(1));

    await notifyOverdueSteps();

    const notifications = await prisma.notification.findMany({ where: { phaseStepId: oneA.id } });
    const recipientIds = new Set(notifications.map((n) => n.userId));
    expect(recipientIds.has(users.accounts)).toBe(false);
    expect(recipientIds.has(users.purchase)).toBe(false);
    expect(recipientIds.has(users.design_engineer)).toBe(false);
  });

  it("marks the step notified, and does not re-notify on a second run", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await backdateStep(oneA.id, daysAgo(3));

    await notifyOverdueSteps();
    const afterFirst = await getStep(project.id, "1A");
    expect(afterFirst.notifiedOverdueAt).not.toBeNull();
    const countAfterFirst = await prisma.notification.count({ where: { phaseStepId: oneA.id } });

    await notifyOverdueSteps();
    const countAfterSecond = await prisma.notification.count({ where: { phaseStepId: oneA.id } });
    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("does not notify a step that is not yet overdue, or one that's already completed", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A"); // planned dates are in the future by default

    const { notified: notifiedBefore } = await notifyOverdueSteps();
    const countBefore = await prisma.notification.count({ where: { phaseStepId: oneA.id } });
    expect(countBefore).toBe(0);

    await prisma.phaseStep.update({
      where: { id: oneA.id },
      data: { plannedEndDate: daysAgo(1), status: "completed" },
    });
    await notifyOverdueSteps();
    const countAfterCompleted = await prisma.notification.count({ where: { phaseStepId: oneA.id } });
    expect(countAfterCompleted).toBe(0);
    void notifiedBefore;
  });
});

describe("rescheduleProjectDates clears the overdue-notified guard", () => {
  it("resets notified_overdue_at to null on a step whose planned_end_date moves", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneB = await getStep(project.id, "1B");

    // Simulate "already notified" for 1B at its original schedule.
    await prisma.phaseStep.update({ where: { id: oneB.id }, data: { notifiedOverdueAt: new Date() } });

    // Backdate 1A's actual end date so 1B's projected start (and therefore end) moves earlier.
    const oneA = await getStep(project.id, "1A");
    const earlier = daysAgo(10);
    await prisma.phaseStep.update({
      where: { id: oneA.id },
      data: { status: "completed", actualStartDate: earlier, actualEndDate: earlier },
    });
    await rescheduleProjectDates(project.id);

    const oneBAfter = await getStep(project.id, "1B");
    expect(oneBAfter.plannedEndDate!.getTime()).not.toBe(oneB.plannedEndDate!.getTime());
    expect(oneBAfter.notifiedOverdueAt).toBeNull();
  });
});

describe("getMyTasks surfaces overdue notification history", () => {
  it("reports zero for a step that's never been flagged overdue", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const items = await getMyTasks(null, { projectId: project.id, includeCompleted: true });
    const oneA = items.find((i) => i.stepCode === "1A")!;
    expect(oneA.timesOverdue).toBe(0);
    expect(oneA.lastOverdueAt).toBeNull();
  });

  it("counts distinct overdue episodes and reports the most recent one", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await backdateStep(oneA.id, daysAgo(5));
    await notifyOverdueSteps();

    const afterFirst = await getMyTasks(null, { projectId: project.id, includeCompleted: true });
    const itemAfterFirst = afterFirst.find((i) => i.stepCode === "1A")!;
    expect(itemAfterFirst.timesOverdue).toBe(1);
    expect(itemAfterFirst.lastOverdueAt).not.toBeNull();

    // Slips further and gets caught by the cron a second time — backdateStep also clears
    // notified_overdue_at, so this is eligible to be (re-)notified, same as reschedule.ts does.
    const firstFlaggedAt = itemAfterFirst.lastOverdueAt;
    await backdateStep(oneA.id, daysAgo(2));
    await notifyOverdueSteps();

    const afterSecond = await getMyTasks(null, { projectId: project.id, includeCompleted: true });
    const itemAfterSecond = afterSecond.find((i) => i.stepCode === "1A")!;
    expect(itemAfterSecond.timesOverdue).toBe(2);
    expect(itemAfterSecond.lastOverdueAt).not.toBe(firstFlaggedAt);
  });
});
