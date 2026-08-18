import { prisma } from "@/lib/prisma";
import type { Department } from "@prisma/client";

const ADMIN_DEPARTMENTS: Department[] = ["owner_admin", "hr_admin"];

function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

/**
 * Finds every not-yet-completed Phase 1/2 step whose planned_end_date has passed and that
 * hasn't already been notified for it (notified_overdue_at is null — see the field's
 * comment in schema.prisma), and creates a Notification for everyone responsible: the
 * step's owning + secondary department, plus the admin-oversight departments (same set
 * isAdminEditor in auth.ts encodes). Marks the step notified so a repeat run doesn't
 * re-notify — that guard is cleared elsewhere whenever the step's planned_end_date
 * actually changes (reschedule.ts, applyVisitUrgency in step-actions.ts).
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

    const recipients = await prisma.user.findMany({
      where: { department: { in: Array.from(departments) } },
      select: { id: true },
    });
    if (recipients.length === 0) continue;

    const message = `${step.stepCode} ${step.stepName} on ${step.project.name} is overdue — was due ${formatShortDate(
      step.plannedEndDate!
    )}`;

    await prisma.$transaction([
      prisma.notification.createMany({
        data: recipients.map((r) => ({
          userId: r.id,
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
