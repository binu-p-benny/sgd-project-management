import { describe, it, expect, afterAll } from "vitest";
import {
  getReviewedPhaseStepIds,
  getPhaseStepReviewExemptCodes,
  isStepFullyDone,
  markTaskReviewed,
} from "@/lib/task-reviews";
import { prisma, TEST_PREFIX } from "../helpers/db";

const createdClientIds: string[] = [];
const createdProjectIds: string[] = [];

async function makeProjectWithStep(stepCode: string, status: "completed" | "not_started" = "completed") {
  const client = await prisma.client.create({
    data: { name: `${TEST_PREFIX}review gate client ${stepCode}-${Date.now()}`, phone: "0000000000", address: "Test address" },
  });
  createdClientIds.push(client.id);
  const project = await prisma.project.create({
    data: {
      name: `${TEST_PREFIX}review gate ${stepCode}-${Date.now()}`,
      clientId: client.id,
      finalCost: 1,
      glassType: "normal",
      currentPhase: "phase_1",
    },
  });
  createdProjectIds.push(project.id);
  const step = await prisma.phaseStep.create({
    data: {
      projectId: project.id,
      phase: "phase_1",
      stepCode,
      stepName: stepCode,
      owningDepartment: "hr_admin",
      dependsOn: [],
      status,
      actualEndDate: status === "completed" ? new Date() : null,
    },
  });
  return { project, step };
}

afterAll(async () => {
  await prisma.phaseStep.deleteMany({ where: { projectId: { in: createdProjectIds } } });
  await prisma.project.deleteMany({ where: { id: { in: createdProjectIds } } });
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
});

describe("isStepFullyDone", () => {
  it("is false for anything that isn't completed, regardless of review state", () => {
    expect(isStepFullyDone({ id: "x", stepCode: "1A", status: "in_progress" }, new Set())).toBe(false);
    expect(isStepFullyDone({ id: "x", stepCode: "1A", status: "blocked" }, new Set(["x"]))).toBe(false);
  });

  it("is false for a completed ordinary step with no matching review", () => {
    expect(isStepFullyDone({ id: "x", stepCode: "1A", status: "completed" }, new Set())).toBe(false);
    expect(isStepFullyDone({ id: "x", stepCode: "1A", status: "completed" }, new Set(["some-other-id"]))).toBe(false);
  });

  it("is true for a completed ordinary step once its id is in the reviewed set", () => {
    expect(isStepFullyDone({ id: "x", stepCode: "1A", status: "completed" }, new Set(["x"]))).toBe(true);
  });

  it("is true for a completed derived/3A/3B step even with no review at all — exempt from the gate", () => {
    for (const stepCode of getPhaseStepReviewExemptCodes()) {
      expect(isStepFullyDone({ id: "x", stepCode, status: "completed" }, new Set())).toBe(true);
    }
  });

  it("getPhaseStepReviewExemptCodes covers exactly the derived steps plus 3A/3B", () => {
    expect([...getPhaseStepReviewExemptCodes()].sort()).toEqual(["2A", "2D1", "2F", "3A", "3B"].sort());
  });
});

describe("getReviewedPhaseStepIds", () => {
  it("returns an empty set for no projects", async () => {
    expect(await getReviewedPhaseStepIds([])).toEqual(new Set());
  });

  it("returns only the ids that have actually been reviewed, scoped to the given projects", async () => {
    const { project: p1, step: s1 } = await makeProjectWithStep("1A");
    const { project: p2, step: s2 } = await makeProjectWithStep("1B");
    const { project: p3, step: s3 } = await makeProjectWithStep("1C");

    await markTaskReviewed(`phase_step:${s1.id}`, null);
    await markTaskReviewed(`phase_step:${s2.id}`, "looked fine");
    // s3/p3 deliberately left unreviewed.

    const reviewed = await getReviewedPhaseStepIds([p1.id, p2.id, p3.id]);
    expect(reviewed.has(s1.id)).toBe(true);
    expect(reviewed.has(s2.id)).toBe(true);
    expect(reviewed.has(s3.id)).toBe(false);

    // Scoping to just p3 excludes the other projects' reviews even though they exist.
    const scopedToP3 = await getReviewedPhaseStepIds([p3.id]);
    expect(scopedToP3.size).toBe(0);
  });

  it("ignores reviews of non-phase-step units (procurement stages, action items, …)", async () => {
    const { project } = await makeProjectWithStep("1D");
    const item = await prisma.procurementItem.create({ data: { projectId: project.id, itemType: "section" } });
    await prisma.procurementItem.update({ where: { id: item.id }, data: { requirementCreatedAt: new Date() } });
    await markTaskReviewed(`procurement_stage:${item.id}:requirementCreatedAt`, null);

    const reviewed = await getReviewedPhaseStepIds([project.id]);
    expect(reviewed.size).toBe(0);
  });
});
