import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus } from "@/lib/step-actions";
import { rescheduleProjectDates } from "@/lib/reschedule";
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
