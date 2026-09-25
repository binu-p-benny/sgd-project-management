import { prisma } from "@/lib/prisma";
import { ADMIN_DEPARTMENTS, formatShortDate, resolveRecipients } from "@/lib/notifications";
import type { Department } from "@prisma/client";

/**
 * Finds every not-yet-completed step whose planned_end_date has passed and that hasn't already
 * been notified for it (notified_overdue_at is null — see the field's comment in schema.prisma),
 * and creates a Notification for everyone responsible: the step's owning + secondary department,
 * plus the admin-oversight departments (same set isAdminEditor in auth.ts encodes). Marks the
 * step notified so a repeat run doesn't re-notify — that guard is cleared elsewhere whenever the
 * step's planned_end_date actually changes (reschedule.ts, applyVisitUrgency in step-actions.ts).
 *
 * Keeps its own notified_overdue_at guard rather than the dedupe_key the other cron kinds use
 * (see notify-cron.ts): the guard predates the key, my-tasks.ts reads it, and clearing it is
 * already wired into every place a planned end date moves.
 */
export async function notifyOverdueSteps(): Promise<{ notified: number }> {
  const now = new Date();

  const overdueSteps = await prisma.phaseStep.findMany({
    where: {
      plannedEndDate: { lt: now },
      status: { not: "completed" },
      notifiedOverdueAt: null,
    },
    include: { project: { select: { id: true, name: true } } },
  });

  let notified = 0;

  for (const step of overdueSteps) {
    const departments = new Set<Department>([step.owningDepartment, ...ADMIN_DEPARTMENTS]);
    if (step.secondaryDepartment) departments.add(step.secondaryDepartment);

    const recipients = await resolveRecipients(Array.from(departments));
    if (recipients.length === 0) continue;

    const message = `${step.stepCode} ${step.stepName} on ${step.project.name} is overdue — was due ${formatShortDate(
      step.plannedEndDate!
    )}`;

    await prisma.$transaction([
      prisma.notification.createMany({
        data: recipients.map((userId) => ({
          userId,
          type: "step_overdue",
          message,
          projectId: step.projectId,
          phaseStepId: step.id,
        })),
      }),
      prisma.phaseStep.update({
        where: { id: step.id },
        data: { notifiedOverdueAt: now },
      }),
    ]);

    notified += 1;
  }

  return { notified };
}
