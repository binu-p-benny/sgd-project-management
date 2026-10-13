import type { Department, GlassType, StepPhase, VisitUrgency } from "@prisma/client";
import { addWorkingDays, rollToWorkingDay } from "@/lib/working-days";

export interface StepTemplateItem {
  stepCode: string;
  stepName: string;
  phase: StepPhase;
  owningDepartment: Department;
  secondaryDepartment?: Department;
  plannedDurationDays: number | null;
  dependsOn: string[];
}

// Phase 1 — onboarding and confirmation. Seeded when a project is created.
export function buildPhase1Steps(): StepTemplateItem[] {
  return [
    {
      stepCode: "1A",
      stepName: "Welcome call + WhatsApp group + visit urgency decision",
      phase: "phase_1",
      owningDepartment: "hr_admin",
      secondaryDepartment: "project_engineer",
      plannedDurationDays: 1,
      dependsOn: [],
    },
    {
      stepCode: "1B",
      stepName: "Site visit",
      phase: "phase_1",
      owningDepartment: "design_engineer",
      plannedDurationDays: null, // derived from visit_urgency once 1A sets it
      dependsOn: ["1A"],
    },
    {
      stepCode: "1C",
      stepName: "Revised drawing confirmation",
      phase: "phase_1",
      owningDepartment: "design_engineer",
      plannedDurationDays: 2,
      dependsOn: ["1B"],
    },
    {
      stepCode: "1D",
      stepName: "Revised quote and payment",
      phase: "phase_1",
      owningDepartment: "accounts",
      plannedDurationDays: 2,
      dependsOn: ["1C"],
    },
  ];
}

// Phase 2 — procurement and prep. Seeded when 1D completes.
export function buildPhase2Steps(): StepTemplateItem[] {
  return [
    {
      stepCode: "2A",
      stepName: "Purchase requirement (section, hardware, gasket)",
      phase: "phase_2",
      owningDepartment: "design_engineer",
      plannedDurationDays: 1,
      dependsOn: ["1D"],
    },
    {
      stepCode: "2D1",
      stepName: "Materials arrived (derived)",
      phase: "phase_2",
      owningDepartment: "purchase",
      plannedDurationDays: 21,
      dependsOn: ["2A"],
    },
    {
      stepCode: "2D2",
      stepName: "Final tight measurement at site",
      phase: "phase_2",
      owningDepartment: "design_engineer",
      plannedDurationDays: 18,
      dependsOn: ["2A"],
    },
    {
      stepCode: "2F",
      stepName: "Material QC (section / hardware / gasket)",
      phase: "phase_2",
      owningDepartment: "purchase",
      plannedDurationDays: 2,
      dependsOn: ["2D1"], // gate also requires getMaterialsArrivedStatus() — see dependency-gate.ts
    },
  ];
}

// Phase 3 — installation. Seeded when 2F completes. 3B's duration depends on glass_type.
export function buildPhase3Steps(glassType: GlassType): StepTemplateItem[] {
  return [
    {
      stepCode: "3A",
      stepName: "Glass PO: requirement, quote, payment",
      phase: "phase_3",
      owningDepartment: "purchase",
      plannedDurationDays: 3,
      dependsOn: ["2F"],
    },
    {
      stepCode: "3B",
      stepName: "Glass delivery",
      phase: "phase_3",
      owningDepartment: "purchase",
      plannedDurationDays: glassType === "laminated" ? 10 : 7,
      dependsOn: ["3A"],
    },
    {
      stepCode: "3C1",
      stepName: "Aluminum framework",
      phase: "phase_3",
      owningDepartment: "project_engineer",
      plannedDurationDays: 7,
      dependsOn: ["2F"],
    },
    {
      stepCode: "3C2",
      stepName: "Installation",
      phase: "phase_3",
      owningDepartment: "project_engineer",
      plannedDurationDays: 7,
      dependsOn: ["3C1"],
    },
    {
      stepCode: "3E",
      stepName: "Final QC on site",
      phase: "phase_3",
      owningDepartment: "project_engineer",
      plannedDurationDays: 5,
      dependsOn: ["3B", "3C2"],
    },
  ];
}

/** 1B's planned duration is derived from visit_urgency once it's set on the project. */
export function deriveVisitDurationDays(urgency: VisitUrgency): number | null {
  switch (urgency) {
    case "emergency":
      return 2;
    case "hot":
      return 5;
    case "cold":
      return 15;
    case "site_not_ready":
      return null; // 1B goes straight to blocked instead of getting a duration
    default:
      return null;
  }
}

/**
 * Phase 1 + Phase 2 combined, with 1B's duration resolved from a known visit_urgency —
 * the template used to compute every Phase 1/2 planned date in one pass at project
 * creation. Already topologically ordered (1A,1B,1C,1D,2A,2D1,2D2,2F), so a single
 * computePlannedDates call resolves the whole chain without a separate anchor handoff
 * between phases.
 */
export function buildPhase1And2Steps(visitUrgency: VisitUrgency): StepTemplateItem[] {
  const phase1 = buildPhase1Steps().map((step) =>
    step.stepCode === "1B" ? { ...step, plannedDurationDays: deriveVisitDurationDays(visitUrgency) } : step
  );
  return [...phase1, ...buildPhase2Steps()];
}

/**
 * Every step_code/step_name in the workflow, in order — a fixed reference list (glass_type
 * only affects 3B's duration, never its name) for UI that needs to enumerate "all possible
 * steps" without scheduling anything, e.g. the project-list "current step" filter.
 */
export function buildAllStepCodes(): { stepCode: string; stepName: string }[] {
  return [...buildPhase1Steps(), ...buildPhase2Steps(), ...buildPhase3Steps("normal")].map((s) => ({
    stepCode: s.stepCode,
    stepName: s.stepName,
  }));
}

// The step_code that, on completion, triggers seeding of the next phase.
export const PHASE_GATE_STEP_CODE = {
  phase_2: "1D",
  phase_3: "2F",
} as const;

/** Plain calendar-day arithmetic — for windows and thresholds, not planned dates. Every
 *  automatically computed planned/due date skips Sundays instead (see working-days.ts). */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

export interface PlannedDates {
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
}

/**
 * A step's planned start/end from the moment it's ready to begin (`readyFrom` — its latest
 * dependency's end) and its duration, both counted around Sundays: the start is rolled off a
 * Sunday onto the Monday, and the end is `durationDays` *working* days after `readyFrom`. The end
 * counts from readyFrom rather than the rolled start on purpose — a dependency finishing on a
 * Sunday shouldn't cost the next step an extra day over one finishing on the Saturday (both mean
 * "Monday is the first working day"). Shared by computePlannedDates below and
 * rescheduleProjectDates so the baseline and every later recompute agree to the day.
 */
export function plannedWindowFrom(readyFrom: Date | null, durationDays: number | null): PlannedDates {
  if (readyFrom === null) return { plannedStartDate: null, plannedEndDate: null };
  return {
    plannedStartDate: rollToWorkingDay(readyFrom),
    plannedEndDate: durationDays === null ? null : addWorkingDays(readyFrom, durationDays),
  };
}

/**
 * Forward-pass baseline scheduler: each step starts when its latest dependency ends
 * (or at anchorDate if it has none), and ends planned_duration_days working days later
 * (Sundays never count, and neither date lands on one — see plannedWindowFrom).
 * `steps` must already be in a topological order (dependencies before dependents) —
 * true of every array returned by the build* functions above. `resolvedDates` carries
 * end dates for steps outside this batch (e.g. an earlier phase's actual_end_date).
 *
 * If a dependency's own end date is unresolved (e.g. 1B before visit_urgency is set,
 * so its duration — and therefore end date — isn't known yet), that unresolved-ness
 * must propagate forward: a step can't have a known planned date if something it
 * depends on doesn't. It must NOT silently fall back to anchorDate, which would claim
 * a start date the step doesn't actually have yet.
 */
export function computePlannedDates(
  steps: StepTemplateItem[],
  anchorDate: Date,
  resolvedDates: Map<string, Date> = new Map()
): Map<string, PlannedDates> {
  const result = new Map<string, PlannedDates>();
  // Date = resolved end; null = processed but end date unresolved; absent = not a dependency we track.
  const endDates = new Map<string, Date | null>(resolvedDates);

  for (const step of steps) {
    let readyFrom: Date | null;
    if (step.dependsOn.length === 0) {
      // Rolled up front (unlike a dependency's end below) so the stored start is also what the
      // end counts from — rescheduleProjectDates only has that stored start to go on for a
      // dependency-free step, and must land on the same end date.
      readyFrom = rollToWorkingDay(anchorDate);
    } else {
      const depEnds = step.dependsOn.map((code) => endDates.get(code));
      const allResolved = depEnds.every((d): d is Date => d instanceof Date);
      readyFrom = allResolved
        ? new Date(Math.max(...(depEnds as Date[]).map((d) => d.getTime())))
        : null;
    }

    const window = plannedWindowFrom(readyFrom, step.plannedDurationDays);
    result.set(step.stepCode, window);
    endDates.set(step.stepCode, window.plannedEndDate);
  }

  return result;
}
