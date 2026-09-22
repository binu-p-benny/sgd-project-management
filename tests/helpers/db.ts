import type { Department, GlassType, VisitUrgency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { buildPhase1Steps, buildPhase1And2Steps, computePlannedDates } from "@/lib/step-template";
import { createEmptyProcurementItemsForProject } from "@/lib/procurement";

export { prisma };

export const TEST_PREFIX = "__TEST__";

const ALL_DEPARTMENTS: Department[] = [
  "hr_admin",
  "project_engineer",
  "design_engineer",
  "purchase",
  "accounts",
  "owner_admin",
  "operations_manager",
];

let cachedUsers: Record<Department, string> | null = null;
let cachedClientId: string | null = null;

/** Upserts one shared throwaway client for every test project/service. Cached per test run,
 *  same "never cleaned up, fixed id so re-runs reuse it" convention as ensureTestUsers. */
async function ensureTestClient(): Promise<string> {
  if (cachedClientId) return cachedClientId;

  const client = await prisma.client.upsert({
    where: { id: "__TEST_CLIENT__" },
    update: {},
    create: {
      id: "__TEST_CLIENT__",
      name: "Test Client",
      phone: "0000000000",
      address: "Test Address",
    },
  });
  cachedClientId = client.id;
  return client.id;
}

/** Upserts one throwaway user per department and returns department -> userId. Cached per test run. */
export async function ensureTestUsers(): Promise<Record<Department, string>> {
  if (cachedUsers) return cachedUsers;

  const ids = {} as Record<Department, string>;
  for (const dept of ALL_DEPARTMENTS) {
    const email = `${TEST_PREFIX}${dept}@test.local`;
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        name: `Test ${dept}`,
        email,
        department: dept,
        passwordHash: "not-a-real-hash",
      },
    });
    ids[dept] = user.id;
  }
  cachedUsers = ids;
  return ids;
}

export async function createTestProject(
  overrides: Partial<{ name: string; glassType: GlassType; finalCost: number }> = {}
) {
  const now = new Date();
  const phase1 = buildPhase1Steps();
  const dates = computePlannedDates(phase1, now);
  const clientId = await ensureTestClient();

  const project = await prisma.project.create({
    data: {
      name: overrides.name ?? `${TEST_PREFIX}Project ${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientId,
      finalCost: overrides.finalCost ?? 100000,
      glassType: overrides.glassType ?? "normal",
      plannedStartDate: now,
      currentPhase: "phase_1",
      overallStatus: "on_track",
    },
  });

  await prisma.phaseStep.createMany({
    data: phase1.map((s) => {
      const d = dates.get(s.stepCode)!;
      return {
        projectId: project.id,
        phase: s.phase,
        stepCode: s.stepCode,
        stepName: s.stepName,
        owningDepartment: s.owningDepartment,
        secondaryDepartment: s.secondaryDepartment,
        plannedDurationDays: s.plannedDurationDays,
        dependsOn: s.dependsOn,
        plannedStartDate: d.plannedStartDate,
        plannedEndDate: d.plannedEndDate,
      };
    }),
  });

  return project;
}

/** Mirrors POST /api/projects: seeds Phase 1+2 together with planned dates computed up front. */
export async function createTestProjectDayOne(
  overrides: Partial<{ name: string; glassType: GlassType; finalCost: number; visitUrgency: VisitUrgency }> = {}
) {
  const now = new Date();
  const visitUrgency = overrides.visitUrgency ?? "hot";
  const steps = buildPhase1And2Steps(visitUrgency);
  const dates = computePlannedDates(steps, now);
  const clientId = await ensureTestClient();

  const project = await prisma.project.create({
    data: {
      name: overrides.name ?? `${TEST_PREFIX}Project ${Date.now()}-${Math.random().toString(36).slice(2)}`,
      clientId,
      finalCost: overrides.finalCost ?? 100000,
      glassType: overrides.glassType ?? "normal",
      visitUrgency,
      plannedStartDate: now,
      currentPhase: "phase_1",
      overallStatus: "on_track",
    },
  });

  await prisma.phaseStep.createMany({
    data: steps.map((s) => {
      const d = dates.get(s.stepCode)!;
      return {
        projectId: project.id,
        phase: s.phase,
        stepCode: s.stepCode,
        stepName: s.stepName,
        owningDepartment: s.owningDepartment,
        secondaryDepartment: s.secondaryDepartment,
        plannedDurationDays: s.plannedDurationDays,
        dependsOn: s.dependsOn,
        plannedStartDate: d.plannedStartDate,
        plannedEndDate: d.plannedEndDate,
      };
    }),
  });

  await createEmptyProcurementItemsForProject(project.id);

  return project;
}

export async function getStep(projectId: string, stepCode: string) {
  return prisma.phaseStep.findFirstOrThrow({ where: { projectId, stepCode } });
}

export async function findStep(projectId: string, stepCode: string) {
  return prisma.phaseStep.findFirst({ where: { projectId, stepCode } });
}

export async function getProject(projectId: string) {
  return prisma.project.findUniqueOrThrow({ where: { id: projectId } });
}

export async function getProcurementItems(projectId: string) {
  return prisma.procurementItem.findMany({ where: { projectId }, orderBy: { itemType: "asc" } });
}

export async function getStatusLogs(phaseStepId: string) {
  return prisma.stepStatusLog.findMany({ where: { phaseStepId }, orderBy: { changedAt: "asc" } });
}

/** Deletes every project created by the test suite (cascades to steps, procurement items, status logs). */
export async function cleanupTestProjects() {
  await prisma.project.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
}
