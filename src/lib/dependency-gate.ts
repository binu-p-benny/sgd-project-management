import { prisma } from "@/lib/prisma";
import { getMaterialsArrivedStatus } from "@/lib/procurement";

export interface GateResult {
  allowed: boolean;
  blockedBy: string[]; // step_codes (or synthetic reasons) not yet satisfied
  // Same entries as blockedBy, but each resolved to its human-readable step name (e.g. "Site
  // measurement & drawing" instead of "3C1") — what a "Waiting on: …" hint should actually
  // display. blockedBy itself stays codes, since that's what the PATCH-rejection error detail
  // (see step-actions.ts) has always returned and other callers may already key off.
  blockedByLabels: string[];
}

// The one synthetic (non-step_code) reason blockedBy can carry — 2F's own extra gate below.
const MATERIALS_ARRIVED_LABEL = "Materials arrived";

/**
 * Checks whether a phase_step is allowed to move to in_progress or completed:
 * every step_code in its depends_on must itself be `completed`, plus any
 * step-specific extra gate (2F needs materials-arrived, 3E needs both its deps).
 */
export async function checkDependencyGate(stepId: string): Promise<GateResult> {
  const step = await prisma.phaseStep.findUniqueOrThrow({
    where: { id: stepId },
    select: { id: true, projectId: true, stepCode: true, dependsOn: true },
  });

  const blockedBy: string[] = [];
  const blockedByLabels: string[] = [];

  if (step.dependsOn.length > 0) {
    const dependencies = await prisma.phaseStep.findMany({
      where: { projectId: step.projectId, stepCode: { in: step.dependsOn } },
      select: { stepCode: true, stepName: true, status: true },
    });

    const byCode = new Map(dependencies.map((d) => [d.stepCode, d]));
    for (const code of step.dependsOn) {
      const dep = byCode.get(code);
      if (dep?.status !== "completed") {
        blockedBy.push(code);
        blockedByLabels.push(dep?.stepName ?? code);
      }
    }
  }

  if (step.stepCode === "2F") {
    const materialsArrived = await getMaterialsArrivedStatus(step.projectId);
    if (!materialsArrived.complete) {
      blockedBy.push("materials_arrived");
      blockedByLabels.push(MATERIALS_ARRIVED_LABEL);
    }
  }

  return { allowed: blockedBy.length === 0, blockedBy, blockedByLabels };
}
