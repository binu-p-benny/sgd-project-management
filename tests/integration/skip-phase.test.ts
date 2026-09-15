import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Department } from "@prisma/client";
import { skipToPhase, StepActionError } from "@/lib/step-actions";
import { createTestProject, ensureTestUsers, cleanupTestProjects, getStep, getProject, getProcurementItems } from "../helpers/db";
import { advanceThroughPhase1 } from "../helpers/scenarios";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

describe("skipToPhase", () => {
  it("skips a day-one project straight to phase_2 — 1A–1D completed as of the given date", async () => {
    const project = await createTestProject();
    const asOfDate = new Date("2026-01-15T00:00:00.000Z");

    await skipToPhase(project.id, "phase_2", asOfDate, users.owner_admin);

    for (const code of ["1A", "1B", "1C", "1D"]) {
      const step = await getStep(project.id, code);
      expect(step.status).toBe("completed");
      expect(step.actualEndDate?.toISOString()).toBe(asOfDate.toISOString());
    }

    const updated = await getProject(project.id);
    expect(updated.currentPhase).toBe("phase_2");

    const items = await getProcurementItems(project.id);
    expect(items).toHaveLength(3);
    // Phase 2's own stages weren't touched by a phase_2 skip — only 1A–1D.
    expect(items.every((i) => i.requirementCreatedAt === null)).toBe(true);
  });

  it("skips a day-one project straight to phase_3 — procurement backfilled, phase_3 itself left open", async () => {
    const project = await createTestProject();
    const asOfDate = new Date("2026-02-01T00:00:00.000Z");

    await skipToPhase(project.id, "phase_3", asOfDate, users.owner_admin);

    for (const code of ["1A", "1B", "1C", "1D", "2A", "2D1", "2F"]) {
      const step = await getStep(project.id, code);
      expect(step.status).toBe("completed");
      expect(step.actualEndDate?.toISOString()).toBe(asOfDate.toISOString());
    }

    // 2D2 is a real site visit, not something a project reaching Phase 3 administratively implies
    // already happened — left open for the project engineer to actually do.
    const step2D2 = await getStep(project.id, "2D2");
    expect(step2D2.status).not.toBe("completed");
    expect(step2D2.actualEndDate).toBeNull();

    const items = await getProcurementItems(project.id);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.qcChecked).toBe(true);
      expect(item.qcPassed).toBe(true);
      expect(item.requirementCreatedAt?.toISOString()).toBe(asOfDate.toISOString());
      expect(item.qcCheckedAt?.toISOString()).toBe(asOfDate.toISOString());
      if (item.itemType === "section") {
        expect(item.materialDespatchAt?.toISOString()).toBe(asOfDate.toISOString());
      }
    }

    const updated = await getProject(project.id);
    expect(updated.currentPhase).toBe("phase_3");

    // Phase 3's own steps are seeded but untouched — the whole point is resuming live tracking.
    const threeC1 = await getStep(project.id, "3C1");
    expect(threeC1.status).toBe("not_started");
    expect(threeC1.actualStartDate).toBeNull();
  });

  it("rejects skipping to a phase the project is already at or past", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users);
    const afterPhase1 = await getProject(project.id);
    expect(afterPhase1.currentPhase).toBe("phase_2");

    await expect(skipToPhase(project.id, "phase_2", new Date(), users.owner_admin)).rejects.toThrow(StepActionError);
  });
});
