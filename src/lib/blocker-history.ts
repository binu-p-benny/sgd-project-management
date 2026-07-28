import { prisma } from "@/lib/prisma";

export interface BlockerHistoryEntry {
  stepCode: string;
  stepName: string;
  reason: string | null;
  blockedBy: string;
  blockedAt: Date;
  resolvedAt: Date | null;
  resolvedStatus: string | null;
  durationDays: number;
}

/**
 * Walks step_status_log to reconstruct every blocking episode for a project: each
 * transition INTO `blocked`, paired with whatever transition next moved that same
 * step OUT of `blocked` (if any yet). Built from the generic audit log rather than a
 * dedicated table, since step_status_log already captures old/new status with who/when.
 */
export async function getBlockerHistory(projectId: string): Promise<BlockerHistoryEntry[]> {
  const logs = await prisma.stepStatusLog.findMany({
    where: { phaseStep: { projectId } },
    include: {
      phaseStep: { select: { stepCode: true, stepName: true } },
      changedByUser: { select: { name: true } },
    },
    orderBy: { changedAt: "asc" },
  });

  const byStep = new Map<string, typeof logs>();
  for (const log of logs) {
    if (!byStep.has(log.phaseStepId)) byStep.set(log.phaseStepId, []);
    byStep.get(log.phaseStepId)!.push(log);
  }

  const entries: BlockerHistoryEntry[] = [];
  const msPerDay = 1000 * 60 * 60 * 24;

  for (const stepLogs of byStep.values()) {
    for (let i = 0; i < stepLogs.length; i++) {
      const log = stepLogs[i];
      if (log.newStatus !== "blocked") continue;

      const resolution = stepLogs.slice(i + 1).find((l) => l.newStatus !== "blocked");
      const resolvedAt = resolution?.changedAt ?? null;

      entries.push({
        stepCode: log.phaseStep.stepCode,
        stepName: log.phaseStep.stepName,
        reason: log.reason,
        blockedBy: log.changedByUser.name,
        blockedAt: log.changedAt,
        resolvedAt,
        resolvedStatus: resolution?.newStatus ?? null,
        durationDays: Math.floor(((resolvedAt ?? new Date()).getTime() - log.changedAt.getTime()) / msPerDay),
      });
    }
  }

  return entries.sort((a, b) => b.blockedAt.getTime() - a.blockedAt.getTime());
}
