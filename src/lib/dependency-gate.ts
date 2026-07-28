import { prisma } from "@/lib/prisma";
import { getMaterialsArrivedStatus } from "@/lib/procurement";

export interface GateResult {
  allowed: boolean;
  blockedBy: string[]; // step_codes (or synthetic reasons) not yet satisfied
}

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

  if (step.dependsOn.length > 0) {
    const dependencies = await prisma.phaseStep.findMany({
      where: { projectId: step.projectId, stepCode: { in: step.dependsOn } },
      select: { stepCode: true, status: true },
    });

    const byCode = new Map(dependencies.map((d) => [d.stepCode, d.status]));
    for (const code of step.dependsOn) {
      if (byCode.get(code) !== "completed") {
        blockedBy.push(code);
      }
    }
  }

  if (step.stepCode === "2F") {
    const materialsArrived = await getMaterialsArrivedStatus(step.projectId);
    if (!materialsArrived.complete) {
      blockedBy.push("materials_arrived");
    }
  }

  return { allowed: blockedBy.length === 0, blockedBy };
}
