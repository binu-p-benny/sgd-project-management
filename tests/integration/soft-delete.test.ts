import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma as filtered } from "@/lib/prisma";
import { PrismaClient } from "@prisma/client";
import { getMyTasks } from "@/lib/my-tasks";
import { getBlockerHistory } from "@/lib/blocker-history";
import {
  getPhaseStatusSummary,
  getProjectSituationCounts,
  getBlockedStepsSorted,
  getDepartmentWorkload,
  getPaymentStatusSummary,
  getRecentActivity,
  getProjectProgressList,
  getStepsDueThisWeek,
  getProcurementDelayBreakdown,
} from "@/lib/dashboard";
import { updateStepStatus } from "@/lib/step-actions";
import { createTestProject, ensureTestUsers, getStep, cleanupTestProjects } from "../helpers/db";
import { advanceThroughPhase1 } from "../helpers/scenarios";
import type { Department } from "@prisma/client";

// A second, unextended client — the only way to see past the soft-delete filter and prove the
// row is still there rather than gone.
const raw = new PrismaClient();

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
  await raw.$disconnect();
});

async function softDelete(projectId: string) {
  await raw.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
}

describe("deleting a project hides it without removing it", () => {
  it("keeps the row and all its children in the database", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await softDelete(project.id);

    const stillThere = await raw.project.findUnique({ where: { id: project.id } });
    expect(stillThere).not.toBeNull();
    expect(stillThere!.deletedAt).not.toBeNull();
    expect(await raw.phaseStep.count({ where: { projectId: project.id } })).toBeGreaterThan(0);
    expect(await raw.procurementItem.count({ where: { projectId: project.id } })).toBe(3);
    expect(
      await raw.stepStatusLog.count({ where: { phaseStep: { projectId: project.id } } })
    ).toBeGreaterThan(0);
  });

  it("disappears from every project read path", async () => {
    const project = await createTestProject();
    await softDelete(project.id);

    expect(await filtered.project.findUnique({ where: { id: project.id } })).toBeNull();
    expect(await filtered.project.findFirst({ where: { id: project.id } })).toBeNull();
    expect((await filtered.project.findMany()).map((p) => p.id)).not.toContain(project.id);
    expect(await filtered.project.count({ where: { id: project.id } })).toBe(0);
    await expect(
      filtered.project.findUniqueOrThrow({ where: { id: project.id } })
    ).rejects.toThrow();
  });

  it("takes its steps, procurement rows and audit trail out of view with it", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    const stepId = (await getStep(project.id, "1A")).id;
    await softDelete(project.id);

    expect(await filtered.phaseStep.count({ where: { projectId: project.id } })).toBe(0);
    expect(await filtered.phaseStep.findUnique({ where: { id: stepId } })).toBeNull();
    expect(await filtered.procurementItem.count({ where: { projectId: project.id } })).toBe(0);
    expect(
      await filtered.stepStatusLog.count({ where: { phaseStep: { projectId: project.id } } })
    ).toBe(0);
    expect(await getBlockerHistory(project.id)).toEqual([]);
  });

  it("drops out of the task lists", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await softDelete(project.id);

    const all = await getMyTasks(null, { includeCompleted: true });
    expect(all.some((t) => t.project.id === project.id)).toBe(false);

    const scoped = await getMyTasks("design_engineer", { includeCompleted: true });
    expect(scoped.some((t) => t.project.id === project.id)).toBe(false);
  });

  it("stops counting towards every dashboard widget", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    // Give it something each widget would otherwise pick up: a blocked step and a due step.
    const twoD2 = await getStep(project.id, "2D2");
    await updateStepStatus(twoD2.id, "blocked", users.design_engineer, {
      blockedReason: "vendor_issue_section",
    });

    const before = {
      counts: await getProjectSituationCounts(),
      blocked: (await getBlockedStepsSorted()).length,
      progress: (await getProjectProgressList({ pageSize: 200 })).rows.length,
      activity: (await getRecentActivity({ limit: 200 })).rows.length,
      due: (await getStepsDueThisWeek(200)).length,
      phases: (await getPhaseStatusSummary()).reduce((n, c) => n + c.count, 0),
      workload: (await getDepartmentWorkload()).reduce((n, r) => n + r.openCount, 0),
      payments: (await getPaymentStatusSummary()).reduce((n, r) => n + r.count, 0),
      procurement: (await getProcurementDelayBreakdown()).reduce((n, r) => n + r.totalCount, 0),
    };

    await softDelete(project.id);

    const after = {
      counts: await getProjectSituationCounts(),
      blocked: (await getBlockedStepsSorted()).length,
      progress: (await getProjectProgressList({ pageSize: 200 })).rows.length,
      activity: (await getRecentActivity({ limit: 200 })).rows.length,
      due: (await getStepsDueThisWeek(200)).length,
      phases: (await getPhaseStatusSummary()).reduce((n, c) => n + c.count, 0),
      workload: (await getDepartmentWorkload()).reduce((n, r) => n + r.openCount, 0),
      payments: (await getPaymentStatusSummary()).reduce((n, r) => n + r.count, 0),
      procurement: (await getProcurementDelayBreakdown()).reduce((n, r) => n + r.totalCount, 0),
    };

    expect(after.counts.total).toBe(before.counts.total - 1);
    expect(after.counts.blocked).toBe(before.counts.blocked - 1);
    expect(after.blocked).toBeLessThan(before.blocked);
    expect(after.progress).toBe(before.progress - 1);
    expect(after.activity).toBeLessThan(before.activity);
    expect(after.due).toBeLessThanOrEqual(before.due);
    expect(after.phases).toBe(before.phases - 1);
    expect(after.workload).toBeLessThan(before.workload);
    expect(after.payments).toBe(before.payments - 1);
    expect(after.procurement).toBeLessThanOrEqual(before.procurement);
  });

  it("leaves other projects alone", async () => {
    const doomed = await createTestProject();
    const keeper = await createTestProject();
    await softDelete(doomed.id);

    const ids = (await filtered.project.findMany()).map((p) => p.id);
    expect(ids).not.toContain(doomed.id);
    expect(ids).toContain(keeper.id);
  });
});
