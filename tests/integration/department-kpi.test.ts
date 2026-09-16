import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Department } from "@prisma/client";
import { resolvePeriodRange } from "@/lib/department-kpi";
import { getCompletedUnits, getDepartmentKpis } from "@/lib/department-kpi-report";
import { markTaskReviewed } from "@/lib/task-reviews";
import { createTestProjectDayOne, ensureTestUsers, cleanupTestProjects, prisma, getStep } from "../helpers/db";
import { advanceThroughPhase1 } from "../helpers/scenarios";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

/** Overwrites a completed step's planned/actual/delay-category directly — the KPI lib only
 *  reads those three, so this sets up any on-time / late / client-caused scenario without
 *  walking the reschedule machinery. */
async function setStepDates(
  projectId: string,
  stepCode: string,
  planned: string,
  actual: string,
  delayCategory: "client_side" | "in_house" | null = null
) {
  const step = await getStep(projectId, stepCode);
  await prisma.phaseStep.update({
    where: { id: step.id },
    data: { plannedEndDate: new Date(planned), actualEndDate: new Date(actual), delayCategory },
  });
}

describe("getCompletedUnits — on-time / late / client-caused classification", () => {
  it("classifies each completed phase step against its planned date and credits the owning department", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);

    await setStepDates(project.id, "1A", "2026-06-05", "2026-06-05"); // hr_admin — on time
    await setStepDates(project.id, "1B", "2026-06-05", "2026-06-03"); // design_engineer — on time
    await setStepDates(project.id, "1C", "2026-06-05", "2026-06-12", "client_side"); // design_engineer — client-caused
    await setStepDates(project.id, "1D", "2026-06-05", "2026-06-09"); // accounts — late by 4

    const units = (await getCompletedUnits(resolvePeriodRange("all_time"))).filter((u) => u.projectId === project.id);

    const oneC = units.find((u) => u.taskLabel.startsWith("1C"))!;
    expect(oneC.department).toBe("design_engineer");
    expect(oneC.outcome).toBe("client_caused");
    expect(oneC.daysLate).toBe(7);

    const oneD = units.find((u) => u.taskLabel.startsWith("1D"))!;
    expect(oneD.department).toBe("accounts");
    expect(oneD.outcome).toBe("late");
    expect(oneD.daysLate).toBe(4);

    expect(units.filter((u) => u.department === "design_engineer" && u.outcome === "on_time")).toHaveLength(1); // 1B
    expect(units.find((u) => u.taskLabel.startsWith("1A"))!.outcome).toBe("on_time");
  });

  it("excludes completions outside the reporting window", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await setStepDates(project.id, "1B", "2026-06-05", "2026-06-03");

    // A window in a different year can't contain a June-2026 completion.
    const range = resolvePeriodRange("this_month", new Date("2030-02-15T12:00:00"));
    const units = (await getCompletedUnits(range)).filter((u) => u.projectId === project.id);
    expect(units).toHaveLength(0);
  });
});

describe("getDepartmentKpis", () => {
  it("ranks the five assignable departments plus Operations Manager — never owner_admin", async () => {
    const { rows } = await getDepartmentKpis(resolvePeriodRange("all_time"));
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.department)).toContain("operations_manager");
    expect(rows.map((r) => r.department)).not.toContain("owner_admin");
    // ranks are 1..6, contiguous, score-descending
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].score).toBeGreaterThanOrEqual(rows[i].score);
    }
  });

  it("a client-caused late completion does not drag the department's on-time rate down", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    // Two design_engineer steps this window: one clean, one late-but-client-caused.
    await setStepDates(project.id, "1B", "2026-07-05", "2026-07-01");
    await setStepDates(project.id, "1C", "2026-07-05", "2026-07-20", "client_side");

    const range = resolvePeriodRange("this_month", new Date("2026-07-25T12:00:00"));
    const units = (await getCompletedUnits(range)).filter(
      (u) => u.projectId === project.id && u.department === "design_engineer"
    );
    expect(units).toHaveLength(2);
    expect(units.filter((u) => u.outcome === "late")).toHaveLength(0);
    expect(units.filter((u) => u.outcome === "client_caused")).toHaveLength(1);
  });
});

describe("Operations Manager reviews — credited as their own on-time/late completions", () => {
  it("scores a late review against completedAt + REVIEW_DUE_DAYS, never the reviewed department", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await setStepDates(project.id, "1A", "2026-08-01", "2026-08-01"); // hr_admin's own completion

    const step = await getStep(project.id, "1A");
    const taskId = `phase_step:${step.id}`;
    await markTaskReviewed(taskId, "looks fine");

    // markTaskReviewed should have snapshotted the step's own completion context onto the row —
    // the whole point of resolveReviewContext, so the KPI report never needs to join back to
    // phase_steps later.
    const stored = await prisma.taskReview.findUniqueOrThrow({ where: { taskId } });
    expect(stored.completedAt).toEqual(step.actualEndDate);
    expect(stored.taskLabel).toBe(step.stepName);
    expect(stored.contextName).toBe(project.name);
    expect(stored.projectId).toBe(project.id);
    expect(stored.reviewNote).toBe("looks fine");

    // Pin completedAt/reviewedAt to known values directly, same "write the exact dates" approach
    // setStepDates uses above, so the on-time/late math is deterministic regardless of when this
    // test runs. Due date is completedAt (1 Aug) + REVIEW_DUE_DAYS (1) = 2 Aug; reviewed 6 Aug is
    // 4 days late.
    await prisma.taskReview.update({
      where: { taskId },
      data: { completedAt: new Date("2026-08-01"), reviewedAt: new Date("2026-08-06") },
    });

    try {
      const units = (await getCompletedUnits(resolvePeriodRange("all_time"))).filter(
        (u) => u.projectId === project.id && u.source === "review"
      );
      expect(units).toHaveLength(1);
      expect(units[0].department).toBe("operations_manager");
      expect(units[0].outcome).toBe("late");
      expect(units[0].daysLate).toBe(4);
      expect(units[0].taskLabel).toBe(step.stepName);
      expect(units[0].contextName).toBe(project.name);
    } finally {
      await prisma.taskReview.deleteMany({ where: { taskId } });
    }
  });

  it("an on-time review doesn't drag the operations-manager score down, and shows up in its KPI row", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await setStepDates(project.id, "1B", "2026-08-10", "2026-08-10");

    const step = await getStep(project.id, "1B");
    const taskId = `phase_step:${step.id}`;
    await markTaskReviewed(taskId, null);
    await prisma.taskReview.update({
      where: { taskId },
      // Reviewed the same day it completed — well clear of the due date (completedAt + 1 day),
      // so this isn't a boundary case.
      data: { completedAt: new Date("2026-08-10"), reviewedAt: new Date("2026-08-10") },
    });

    try {
      const range = resolvePeriodRange("all_time");
      const units = (await getCompletedUnits(range)).filter(
        (u) => u.projectId === project.id && u.source === "review"
      );
      expect(units).toHaveLength(1);
      expect(units[0].outcome).toBe("on_time");

      const { rows } = await getDepartmentKpis(range);
      const opsRow = rows.find((r) => r.department === "operations_manager")!;
      expect(opsRow).toBeDefined();
      expect(opsRow.completed).toBeGreaterThan(0);
    } finally {
      await prisma.taskReview.deleteMany({ where: { taskId } });
    }
  });
});
