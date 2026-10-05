import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { getUnifiedMyTasks } from "@/lib/unified-tasks";
import { nextRecurrenceDate, listCommonTasks } from "@/lib/common-tasks";
import { notifyOverdueCommonTasks } from "@/lib/notify-cron";
import { ensureTestUsers, prisma } from "../helpers/db";
import type { Department, RecurrenceFrequency } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

const createdIds: string[] = [];

afterEach(async () => {
  if (createdIds.length) {
    // dedupeKey is "common_task:<id>:<day>" (see notifyOverdueCommonTasks) — match on the id
    // prefix rather than an exact key, since the day stamp varies by test.
    await prisma.notification.deleteMany({
      where: { OR: createdIds.map((id) => ({ dedupeKey: { startsWith: `common_task:${id}:` } })) },
    });
    await prisma.commonTask.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  }
});

async function raise(overrides: Partial<{
  taskLabel: string;
  department: Department;
  recurrence: RecurrenceFrequency;
  plannedDate: Date;
  actualDate: Date | null;
  deletedAt: Date | null;
  note: string | null;
}> = {}) {
  const task = await prisma.commonTask.create({
    data: {
      taskLabel: overrides.taskLabel ?? "Water the plants",
      department: overrides.department ?? "hr_admin",
      recurrence: overrides.recurrence ?? "none",
      plannedDate: overrides.plannedDate ?? new Date(),
      actualDate: overrides.actualDate ?? null,
      deletedAt: overrides.deletedAt ?? null,
      note: overrides.note ?? null,
    },
  });
  createdIds.push(task.id);
  return task;
}

describe("nextRecurrenceDate", () => {
  it("advances daily/weekly/monthly by their own interval from the planned date", () => {
    const planned = new Date("2026-01-05T00:00:00.000Z");
    const completedOnTime = new Date("2026-01-05T09:00:00.000Z");
    expect(nextRecurrenceDate(planned, completedOnTime, "daily").toISOString().slice(0, 10)).toBe("2026-01-06");
    expect(nextRecurrenceDate(planned, completedOnTime, "weekly").toISOString().slice(0, 10)).toBe("2026-01-12");
    expect(nextRecurrenceDate(planned, completedOnTime, "monthly").toISOString().slice(0, 10)).toBe("2026-02-05");
  });

  it("anchors on the completion date instead when it's later than planned (a late completion)", () => {
    const planned = new Date("2026-01-05T00:00:00.000Z");
    const completedLate = new Date("2026-01-20T00:00:00.000Z");
    // Weekly from the 20th, not from the original 5th — otherwise a late completion would land
    // the next cycle in the past and show up as already overdue.
    expect(nextRecurrenceDate(planned, completedLate, "weekly").toISOString().slice(0, 10)).toBe("2026-01-27");
  });
});

describe("common tasks in /my-tasks", () => {
  it("reaches the department it was assigned to, and nobody else", async () => {
    const task = await raise({ taskLabel: "Renew the trade license", department: "accounts" });

    const accounts = await getUnifiedMyTasks("accounts");
    const mine = accounts.find((t) => t.kind === "common_task" && t.refId === task.id);
    expect(mine).toBeDefined();
    expect(mine!.taskLabel).toBe("Renew the trade license");
    expect(mine!.project.id).toBe("");

    const purchase = await getUnifiedMyTasks("purchase");
    expect(purchase.some((t) => t.kind === "common_task" && t.refId === task.id)).toBe(false);
  });

  it("a one-off task drops out of the list once it's done, same as a follow-up", async () => {
    const task = await raise({ department: "purchase", recurrence: "none" });
    expect((await getUnifiedMyTasks("purchase")).some((t) => t.refId === task.id)).toBe(true);

    await prisma.commonTask.update({ where: { id: task.id }, data: { actualDate: new Date() } });

    expect((await getUnifiedMyTasks("purchase")).some((t) => t.refId === task.id)).toBe(false);
  });

  it("a retired (soft-deleted) task disappears from the list", async () => {
    const task = await raise({ department: "design_engineer" });
    expect((await getUnifiedMyTasks("design_engineer")).some((t) => t.refId === task.id)).toBe(true);

    await prisma.commonTask.update({ where: { id: task.id }, data: { deletedAt: new Date() } });

    expect((await getUnifiedMyTasks("design_engineer")).some((t) => t.refId === task.id)).toBe(false);
  });
});

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function notificationsFor(taskId: string) {
  return prisma.notification.findMany({ where: { dedupeKey: { startsWith: `common_task:${taskId}:` } } });
}

describe("common_task_overdue", () => {
  it("notifies the owning department plus admins once a common task is past its planned date", async () => {
    const task = await raise({ taskLabel: "Renew fire extinguishers", department: "purchase", plannedDate: daysAgo(3) });

    await notifyOverdueCommonTasks();

    const notifications = await notificationsFor(task.id);
    expect(notifications.length).toBeGreaterThan(0);
    expect(notifications.map((n) => n.userId).sort()).toEqual(
      [users.purchase, users.owner_admin, users.hr_admin, users.operations_manager].sort()
    );
    expect(notifications[0].message).toContain("Renew fire extinguishers");
    expect(notifications[0].message).toContain("is overdue");

    // Same planned date on a second run — same dedupe key, nothing new.
    await notifyOverdueCommonTasks();
    expect((await notificationsFor(task.id)).length).toBe(notifications.length);
  });

  it("stays quiet for a task that isn't due yet, or is already done", async () => {
    const notDue = await raise({ department: "accounts", plannedDate: new Date(Date.now() + 86_400_000) });
    const done = await raise({ department: "accounts", plannedDate: daysAgo(2), actualDate: new Date() });

    await notifyOverdueCommonTasks();

    expect(await notificationsFor(notDue.id)).toHaveLength(0);
    expect(await notificationsFor(done.id)).toHaveLength(0);
  });

  it("notifies again once a recurring task's own advanced date is itself overdue", async () => {
    const task = await raise({ department: "hr_admin", recurrence: "weekly", plannedDate: daysAgo(10) });
    await notifyOverdueCommonTasks();
    const first = (await notificationsFor(task.id)).length;

    // Completing it advances plannedDate by a week (see nextRecurrenceDate) — still in the past
    // here, so it's overdue again under a fresh dedupe key rather than the same one.
    await prisma.commonTask.update({ where: { id: task.id }, data: { plannedDate: daysAgo(2) } });
    await notifyOverdueCommonTasks();

    expect((await notificationsFor(task.id)).length).toBeGreaterThan(first);
  });

  it("leaves a retired task alone", async () => {
    const task = await raise({ department: "purchase", plannedDate: daysAgo(5), deletedAt: new Date() });

    await notifyOverdueCommonTasks();

    expect(await notificationsFor(task.id)).toHaveLength(0);
  });
});

describe("standing note vs completion note", () => {
  it("surfaces lastCompletionNote as the /my-tasks completion field, leaving note (the standing description) alone", async () => {
    const task = await raise({ taskLabel: "Check the fire extinguishers", note: "Check the pressure gauge is in the green" });

    const mine = (await getUnifiedMyTasks(task.department)).find((t) => t.refId === task.id)!;
    expect(mine.noteField).toBe("lastCompletionNote");
    expect(mine.notes).toBe("Check the pressure gauge is in the green");

    // Simulates what PATCH /api/common-tasks/[id] does when completing it with a note — writes
    // lastCompletionNote, never touches note.
    await prisma.commonTask.update({
      where: { id: task.id },
      data: { actualDate: new Date(), lastCompletedAt: new Date(), lastCompletionNote: "Topped up, all good" },
    });

    const updated = (await listCommonTasks()).find((t) => t.id === task.id)!;
    expect(updated.note).toBe("Check the pressure gauge is in the green");
    expect(updated.lastCompletionNote).toBe("Topped up, all good");
  });
});

describe("skipping a recurring cycle", () => {
  it("advances plannedDate the same way a completion would, without touching lastCompletedAt", async () => {
    const task = await raise({
      recurrence: "weekly",
      plannedDate: new Date("2026-01-05T00:00:00.000Z"),
      department: "hr_admin",
    });

    // Mirrors the `skip: true` branch in PATCH /api/common-tasks/[id].
    const skippedTo = nextRecurrenceDate(task.plannedDate, new Date("2026-01-06T00:00:00.000Z"), "weekly");
    await prisma.commonTask.update({ where: { id: task.id }, data: { plannedDate: skippedTo } });

    const updated = (await listCommonTasks()).find((t) => t.id === task.id)!;
    expect(updated.plannedDate.slice(0, 10)).toBe("2026-01-13");
    expect(updated.lastCompletedAt).toBeNull();
  });

  it("still reaches /my-tasks after being skipped — a skip reopens the row, it doesn't close it", async () => {
    const task = await raise({ recurrence: "weekly", department: "purchase" });
    const skippedTo = nextRecurrenceDate(task.plannedDate, new Date(), "weekly");
    await prisma.commonTask.update({ where: { id: task.id }, data: { plannedDate: skippedTo } });

    const mine = (await getUnifiedMyTasks("purchase")).find((t) => t.refId === task.id);
    expect(mine).toBeDefined();
    expect(mine!.plannedDate?.slice(0, 10)).toBe(skippedTo.toISOString().slice(0, 10));
  });
});
