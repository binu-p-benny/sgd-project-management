import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getProjectFollowUps, anchorKey } from "@/lib/follow-ups";
import { getUnifiedMyTasks } from "@/lib/unified-tasks";
import { createTestProject, ensureTestUsers, getStep, prisma, cleanupTestProjects } from "../helpers/db";
import type { Department } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

async function raise(
  projectId: string,
  anchor: { phaseStepId?: string; procurementItemId?: string; glassPurchaseOrderId?: string },
  overrides: Partial<{ taskLabel: string; department: Department; plannedDate: Date; actualDate: Date | null }> = {}
) {
  return prisma.followUpTask.create({
    data: {
      projectId,
      taskLabel: overrides.taskLabel ?? "Chase the vendor",
      department: overrides.department ?? "purchase",
      plannedDate: overrides.plannedDate ?? new Date(),
      actualDate: overrides.actualDate ?? null,
      ...anchor,
    },
  });
}

describe("getProjectFollowUps", () => {
  it("groups follow-ups under the card they were raised from", async () => {
    const project = await createTestProject({});
    const oneA = await getStep(project.id, "1A");
    const oneB = await getStep(project.id, "1B");

    await raise(project.id, { phaseStepId: oneA.id }, { taskLabel: "Call the client back" });
    await raise(project.id, { phaseStepId: oneA.id }, { taskLabel: "Confirm the WhatsApp group" });
    await raise(project.id, { phaseStepId: oneB.id }, { taskLabel: "Reschedule the visit" });

    const grouped = await getProjectFollowUps(project.id);

    expect(grouped[anchorKey({ kind: "phase_step", id: oneA.id })].map((f) => f.taskLabel)).toEqual([
      "Call the client back",
      "Confirm the WhatsApp group",
    ]);
    expect(grouped[anchorKey({ kind: "phase_step", id: oneB.id })]).toHaveLength(1);
  });

  it("groups a procurement item's own follow-ups separately from a step's", async () => {
    const project = await createTestProject({});
    const oneA = await getStep(project.id, "1A");
    const item = await prisma.procurementItem.create({
      data: { projectId: project.id, itemType: "section" },
    });

    await raise(project.id, { phaseStepId: oneA.id });
    await raise(project.id, { procurementItemId: item.id }, { taskLabel: "Ask for the revised quote" });

    const grouped = await getProjectFollowUps(project.id);
    expect(Object.keys(grouped).sort()).toEqual(
      [anchorKey({ kind: "phase_step", id: oneA.id }), anchorKey({ kind: "procurement_item", id: item.id })].sort()
    );
    expect(grouped[anchorKey({ kind: "procurement_item", id: item.id })][0].taskLabel).toBe(
      "Ask for the revised quote"
    );
  });

  it("returns nothing for a project with none", async () => {
    const project = await createTestProject({});
    expect(await getProjectFollowUps(project.id)).toEqual({});
  });

  it("goes with the step it hangs off when that step is deleted", async () => {
    const project = await createTestProject({});
    const oneA = await getStep(project.id, "1A");
    await raise(project.id, { phaseStepId: oneA.id });

    await prisma.phaseStep.delete({ where: { id: oneA.id } });

    expect(await getProjectFollowUps(project.id)).toEqual({});
  });
});

describe("follow-ups in /my-tasks", () => {
  it("reaches the department it was assigned to, and nobody else", async () => {
    const project = await createTestProject({});
    const oneA = await getStep(project.id, "1A");
    const followUp = await raise(
      project.id,
      { phaseStepId: oneA.id },
      { taskLabel: "Chase the drawing", department: "design_engineer" }
    );

    const design = await getUnifiedMyTasks("design_engineer");
    const mine = design.find((t) => t.kind === "follow_up" && t.refId === followUp.id);
    expect(mine).toBeDefined();
    expect(mine!.taskLabel).toBe("Chase the drawing");
    // The card it came from travels with it, so the row explains itself in the task list.
    expect(mine!.subTaskLabel).toContain("1A");
    expect(mine!.project.id).toBe(project.id);

    const purchase = await getUnifiedMyTasks("purchase");
    expect(purchase.some((t) => t.kind === "follow_up" && t.refId === followUp.id)).toBe(false);
  });

  it("drops out of the list once it's done", async () => {
    const project = await createTestProject({});
    const oneA = await getStep(project.id, "1A");
    const followUp = await raise(project.id, { phaseStepId: oneA.id }, { department: "purchase" });

    expect((await getUnifiedMyTasks("purchase")).some((t) => t.refId === followUp.id)).toBe(true);

    await prisma.followUpTask.update({ where: { id: followUp.id }, data: { actualDate: new Date() } });

    expect((await getUnifiedMyTasks("purchase")).some((t) => t.refId === followUp.id)).toBe(false);
  });

  it("disappears with a soft-deleted project", async () => {
    const project = await createTestProject({});
    const oneA = await getStep(project.id, "1A");
    const followUp = await raise(project.id, { phaseStepId: oneA.id }, { department: "accounts" });
    expect((await getUnifiedMyTasks("accounts")).some((t) => t.refId === followUp.id)).toBe(true);

    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });

    expect((await getUnifiedMyTasks("accounts")).some((t) => t.refId === followUp.id)).toBe(false);
    expect(await getProjectFollowUps(project.id)).toEqual({});

    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: null } });
  });
});

describe("follow-up ownership", () => {
  it("records who raised it", async () => {
    const project = await createTestProject({});
    const oneA = await getStep(project.id, "1A");
    await prisma.followUpTask.create({
      data: {
        projectId: project.id,
        phaseStepId: oneA.id,
        taskLabel: "Raised by someone",
        department: "purchase",
        plannedDate: new Date(),
        createdByUserId: users.owner_admin,
      },
    });

    const grouped = await getProjectFollowUps(project.id);
    expect(grouped[anchorKey({ kind: "phase_step", id: oneA.id })][0].createdByName).toBeTruthy();
  });
});
