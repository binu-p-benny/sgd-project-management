import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Department } from "@prisma/client";
import { resolvePeriodRange } from "@/lib/department-kpi";
import { getCompletedUnits, getDepartmentKpis } from "@/lib/department-kpi-report";
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
  it("ranks only the five assignable departments — never owner_admin", async () => {
    const { rows } = await getDepartmentKpis(resolvePeriodRange("all_time"));
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.department)).not.toContain("owner_admin");
    // ranks are 1..5, contiguous, score-descending
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
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
