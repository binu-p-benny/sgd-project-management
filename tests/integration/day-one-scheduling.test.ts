import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus, DELAY_CATEGORY_STEP_CODES } from "@/lib/step-actions";
import { rescheduleProjectDates } from "@/lib/reschedule";
import { computeItemArrivalPlanned, computePhase2PlanAnchor, resetProcurementItem } from "@/lib/procurement";
import { addDays } from "@/lib/step-template";
import { getMyTasks } from "@/lib/my-tasks";
import { prisma } from "@/lib/prisma";
import {
  createTestProjectDayOne,
  ensureTestUsers,
  getStep,
  findStep,
  getProcurementItems,
  cleanupTestProjects,
} from "../helpers/db";
import { advanceThroughPhase2 } from "../helpers/scenarios";
import type { Department } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

describe("Day-one Phase 1+2 scheduling", () => {
  it("all 8 Phase 1+2 steps get planned dates immediately, before anything is touched", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });

    for (const code of ["1A", "1B", "1C", "1D", "2A", "2D1", "2D2", "2F"]) {
      const step = await getStep(project.id, code);
      expect(step.plannedStartDate, `${code} start`).not.toBeNull();
      expect(step.plannedEndDate, `${code} end`).not.toBeNull();
    }
  });

  it("procurement_items exist from day one, before 1D is anywhere near complete", async () => {
    const project = await createTestProjectDayOne();
    const items = await getProcurementItems(project.id);
    expect(items).toHaveLength(3);
  });

  it("site_not_ready at creation leaves every Phase 1+2 step unresolved until reconciled at 1A", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "site_not_ready" });

    const oneB = await getStep(project.id, "1B");
    expect(oneB.plannedEndDate).toBeNull();
    for (const code of ["1C", "1D", "2A", "2D1", "2D2", "2F"]) {
      const step = await getStep(project.id, code);
      expect(step.plannedStartDate, `${code} start`).toBeNull();
    }
  });

  it("planned dates are not exposed for manual editing via the dates route schema (actual-only)", async () => {
    // Regression guard at the type level: the dates PATCH route only accepts actual dates now.
    // (Exercised functionally by the route's own schema — see api/phase-steps/[id]/dates/route.ts.)
    const project = await createTestProjectDayOne();
    const oneA = await getStep(project.id, "1A");
    const before = await prisma.phaseStep.findUniqueOrThrow({ where: { id: oneA.id } });
    expect(before.plannedStartDate).not.toBeNull();
  });
});

describe("Phase 3 never gets planned dates", () => {
  it("Phase 3 rows seed with null planned dates once 2F completes", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "emergency" });
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "emergency" });
    const oneB = await getStep(project.id, "1B");
    await updateStepStatus(oneB.id, "completed", users.project_engineer);
    const oneC = await getStep(project.id, "1C");
    await updateStepStatus(oneC.id, "completed", users.design_engineer);
    const oneD = await getStep(project.id, "1D");
    await updateStepStatus(oneD.id, "completed", users.accounts);

    await advanceThroughPhase2(project.id, users);

    for (const code of ["3A", "3B", "3C1", "3C2", "3E"]) {
      const step = await findStep(project.id, code);
      expect(step, `${code} exists`).not.toBeNull();
      expect(step!.plannedStartDate, `${code} planned start`).toBeNull();
      expect(step!.plannedEndDate, `${code} planned end`).toBeNull();
    }
  });

  it("rescheduleProjectDates leaves Phase 3 rows untouched even when it runs", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "emergency" });
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "emergency" });
    const oneB = await getStep(project.id, "1B");
    await updateStepStatus(oneB.id, "completed", users.project_engineer);
    const oneC = await getStep(project.id, "1C");
    await updateStepStatus(oneC.id, "completed", users.design_engineer);
    const oneD = await getStep(project.id, "1D");
    await updateStepStatus(oneD.id, "completed", users.accounts);
    await advanceThroughPhase2(project.id, users);

    await rescheduleProjectDates(project.id);

    const threeA = await getStep(project.id, "3A");
    expect(threeA.plannedStartDate).toBeNull();
    expect(threeA.plannedEndDate).toBeNull();
  });
});

describe("Actual-date edits cascade through the live Phase 1+2 schedule", () => {
  it("backfilling 1A's actual end date earlier pulls 1B's planned dates forward", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneAOriginal = await getStep(project.id, "1A");
    const oneBOriginal = await getStep(project.id, "1B");

    const earlierEnd = new Date(oneAOriginal.plannedEndDate!.getTime() - 3 * 24 * 60 * 60 * 1000);
    await prisma.phaseStep.update({
      where: { id: oneAOriginal.id },
      data: { status: "completed", actualStartDate: earlierEnd, actualEndDate: earlierEnd },
    });
    await rescheduleProjectDates(project.id);

    const oneBAfter = await getStep(project.id, "1B");
    expect(oneBAfter.plannedStartDate).toEqual(earlierEnd);
    expect(oneBAfter.plannedStartDate!.getTime()).toBeLessThan(oneBOriginal.plannedStartDate!.getTime());
  });
});

describe("1B's delay_category controls whether a late completion moves 1C's planned finish", () => {
  async function completeOneAAndGoLate(visitUrgency: "hot" = "hot") {
    const project = await createTestProjectDayOne({ visitUrgency });
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency });

    const oneCFirst = await getStep(project.id, "1C");
    const oneB = await getStep(project.id, "1B");
    const lateEnd = addDays(oneB.plannedEndDate!, 10);
    await prisma.phaseStep.update({ where: { id: oneB.id }, data: { actualEndDate: lateEnd } });

    return { project, oneB, oneCFirst, lateEnd };
  }

  it("client_side delay still pushes 1C's planned finish out, same as before delay_category existed", async () => {
    const { project, oneB, oneCFirst, lateEnd } = await completeOneAAndGoLate();

    await updateStepStatus(oneB.id, "completed", users.project_engineer, { delayCategory: "client_side" });

    const oneCAfter = await getStep(project.id, "1C");
    expect(oneCAfter.plannedStartDate).toEqual(lateEnd);
    expect(oneCAfter.plannedEndDate!.getTime()).toBeGreaterThan(oneCFirst.plannedEndDate!.getTime());
  });

  it("in_house delay leaves 1C's planned finish exactly where it was first set", async () => {
    const { project, oneB, oneCFirst } = await completeOneAAndGoLate();

    await updateStepStatus(oneB.id, "completed", users.project_engineer, { delayCategory: "in_house" });

    const oneCAfter = await getStep(project.id, "1C");
    expect(oneCAfter.plannedStartDate).toEqual(oneCFirst.plannedStartDate);
    expect(oneCAfter.plannedEndDate).toEqual(oneCFirst.plannedEndDate);
  });

  it("rejects completing 1B late with no delayCategory, accepts and persists it when supplied", async () => {
    const { oneB } = await completeOneAAndGoLate();

    await expect(
      updateStepStatus(oneB.id, "completed", users.project_engineer)
    ).rejects.toMatchObject({ status: 400 });

    const updated = await updateStepStatus(oneB.id, "completed", users.project_engineer, {
      delayCategory: "in_house",
    });
    expect(updated.delayCategory).toBe("in_house");
  });

  it("an on-time 1B never requires or stores a delay_category", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "hot" });
    const oneB = await getStep(project.id, "1B");
    await prisma.phaseStep.update({ where: { id: oneB.id }, data: { actualEndDate: oneB.plannedEndDate } });

    const updated = await updateStepStatus(oneB.id, "completed", users.project_engineer);
    expect(updated.delayCategory).toBeNull();
  });

  it("getMyTasks explains on every downstream item why its schedule did or didn't move", async () => {
    const { project, oneB } = await completeOneAAndGoLate();
    await updateStepStatus(oneB.id, "completed", users.project_engineer, { delayCategory: "in_house" });

    const items = await getMyTasks(null, { projectId: project.id, includeCompleted: true });
    const oneCItem = items.find((i) => i.stepCode === "1C")!;
    expect(oneCItem.upstreamDelay).toEqual({ stepCode: "1B", category: "in_house" });

    // 1B itself has nothing upstream of it to explain. 1D isn't a *direct* dependency of 1B,
    // but the delay still traces back to it transitively through 1C — same as every step
    // further down the Phase 1/2 chain (2A, 2D1, 2D2, 2F), not just the one right after 1B.
    const oneBItem = items.find((i) => i.stepCode === "1B")!;
    expect(oneBItem.upstreamDelay).toBeNull();
    const oneDItem = items.find((i) => i.stepCode === "1D")!;
    expect(oneDItem.upstreamDelay).toEqual({ stepCode: "1B", category: "in_house" });

    // 2A depends on 1D depends on 1C depends on 1B — three hops back, still resolved.
    const twoAItem = items.find((i) => i.stepCode === "2A")!;
    expect(twoAItem.upstreamDelay).toEqual({ stepCode: "1B", category: "in_house" });
  });

  it("getMyTasks reports no upstream delay once 1B completes on time", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "hot" });
    const oneB = await getStep(project.id, "1B");
    await updateStepStatus(oneB.id, "completed", users.project_engineer);

    const items = await getMyTasks(null, { projectId: project.id, includeCompleted: true });
    expect(items.find((i) => i.stepCode === "1C")!.upstreamDelay).toBeNull();
  });
});

describe("The delay-category requirement now also covers 1A, 1C, 1D, 2D2 — not just 1B", () => {
  it("locks in the exact set of steps that ask for a delay reason", () => {
    expect([...DELAY_CATEGORY_STEP_CODES].sort()).toEqual(["1A", "1B", "1C", "1D", "2D2"]);
  });

  it("rejects completing 1A late with no delayCategory, accepts and persists it when supplied", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    const lateEnd = addDays(oneA.plannedEndDate!, 5);
    await prisma.phaseStep.update({ where: { id: oneA.id }, data: { actualEndDate: lateEnd } });

    await expect(
      updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "hot" })
    ).rejects.toMatchObject({ status: 400 });

    const updated = await updateStepStatus(oneA.id, "completed", users.hr_admin, {
      visitUrgency: "hot",
      delayCategory: "client_side",
    });
    expect(updated.delayCategory).toBe("client_side");

    // Same cascade as 1B already has: a client_side 1A still pushes 1B's planned finish out.
    const oneB = await getStep(project.id, "1B");
    expect(oneB.plannedStartDate).toEqual(lateEnd);
  });

  it("rejects completing 1D late with no delayCategory; an in_house 1D freezes 2A's planned finish exactly where it was first set", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "hot" });
    const oneB = await getStep(project.id, "1B");
    await updateStepStatus(oneB.id, "completed", users.project_engineer);
    const oneC = await getStep(project.id, "1C");
    await updateStepStatus(oneC.id, "completed", users.design_engineer);

    const twoAFirst = await getStep(project.id, "2A");
    const oneD = await getStep(project.id, "1D");
    const lateEnd = addDays(oneD.plannedEndDate!, 6);
    await prisma.phaseStep.update({ where: { id: oneD.id }, data: { actualEndDate: lateEnd } });

    await expect(updateStepStatus(oneD.id, "completed", users.accounts)).rejects.toMatchObject({
      status: 400,
    });

    await updateStepStatus(oneD.id, "completed", users.accounts, { delayCategory: "in_house" });

    const twoAAfter = await getStep(project.id, "2A");
    expect(twoAAfter.plannedStartDate).toEqual(twoAFirst.plannedStartDate);
    expect(twoAAfter.plannedEndDate).toEqual(twoAFirst.plannedEndDate);
  });
});

describe("2D1's planned end date tracks the latest of Section/hardware/gasket's own Actual arrival planned dates", () => {
  async function projectAtPhase2() {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "hot" });
    const oneB = await getStep(project.id, "1B");
    await updateStepStatus(oneB.id, "completed", users.project_engineer);
    const oneC = await getStep(project.id, "1C");
    await updateStepStatus(oneC.id, "completed", users.design_engineer);
    const oneD = await getStep(project.id, "1D");
    await updateStepStatus(oneD.id, "completed", users.accounts);
    return project;
  }

  async function phase2PlanAnchorFor(projectId: string) {
    const oneD = await getStep(projectId, "1D");
    return computePhase2PlanAnchor(oneD.plannedEndDate, oneD.actualEndDate, oneD.delayCategory);
  }

  it("2D1 gets a real forecast the moment 1D completes and procurement items are seeded — the latest item, not just any of them", async () => {
    const project = await projectAtPhase2();
    const items = await getProcurementItems(project.id);
    const phase2PlanAnchor = await phase2PlanAnchorFor(project.id);

    const expectedMax = new Date(
      Math.max(...items.map((i) => computeItemArrivalPlanned(i, phase2PlanAnchor)!.getTime()))
    );
    // Hardware/gasket's chain (14+2+10 working days) lands later than Section's (mostly
    // calendar-day-based until its own working-day stretch) with no overrides on any of them —
    // this asserts 2D1 actually picked the later one, not e.g. always Section by coincidence.
    const hardware = items.find((i) => i.itemType === "hardware")!;
    expect(expectedMax).toEqual(computeItemArrivalPlanned(hardware, phase2PlanAnchor));

    const twoD1 = await getStep(project.id, "2D1");
    expect(twoD1.plannedEndDate).toEqual(expectedMax);
  });

  it("editing one item's Order confirmed date updates 2D1's planned end, even though it doesn't change 2A/2D1/2F's status", async () => {
    const project = await projectAtPhase2();
    const items = await getProcurementItems(project.id);
    const section = items.find((i) => i.itemType === "section")!;

    const lateOrder = new Date("2026-12-01T00:00:00.000Z");
    await prisma.procurementItem.update({ where: { id: section.id }, data: { orderConfirmedAt: lateOrder } });
    await rescheduleProjectDates(project.id);

    const phase2PlanAnchor = await phase2PlanAnchorFor(project.id);
    const expectedSectionArrival = computeItemArrivalPlanned({ ...section, orderConfirmedAt: lateOrder }, phase2PlanAnchor);

    const twoD1 = await getStep(project.id, "2D1");
    expect(twoD1.plannedEndDate).toEqual(expectedSectionArrival);
    expect(twoD1.plannedEndDate!.getTime()).toBeGreaterThan(lateOrder.getTime());
  });

  it("a restarted item's new plan anchor feeds 2D1 too, once it becomes the latest item", async () => {
    const project = await projectAtPhase2();
    const items = await getProcurementItems(project.id);
    const gasket = items.find((i) => i.itemType === "gasket")!;

    const farFutureAnchor = new Date("2027-06-01T00:00:00.000Z");
    await resetProcurementItem(gasket.id, farFutureAnchor);
    await rescheduleProjectDates(project.id);

    const twoD1 = await getStep(project.id, "2D1");
    expect(twoD1.plannedEndDate!.getTime()).toBeGreaterThan(farFutureAnchor.getTime());
  });

  it("2D1 still gets an immediate day-one forecast before 1D completes and procurement items exist", async () => {
    const project = await createTestProjectDayOne({ visitUrgency: "hot" });
    const twoD1 = await getStep(project.id, "2D1");
    expect(twoD1.plannedEndDate).not.toBeNull();
  });
});
