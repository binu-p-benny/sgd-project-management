import type { StepPhase, StepStatus } from "@prisma/client";

/**
 * Wording for the client portal. Pure — no prisma, no server-only imports — so the portal's
 * client components can use it directly.
 *
 * The internal step names are written for the departments that do the work ("Purchase
 * requirement (section, hardware, gasket)", "Materials arrived (derived)"), and a couple of them
 * leak implementation detail a client has no use for. These are the same steps said plainly.
 */
export const PORTAL_STEP_LABELS: Record<string, string> = {
  "1A": "Welcome call and project kick-off",
  "1B": "Site visit",
  "1C": "Drawing confirmation",
  "1D": "Quote confirmation and payment",
  "2A": "Material requirement prepared",
  "2D1": "Materials arrived",
  "2D2": "Final measurement at site",
  "2F": "Material quality check",
  "3A": "Glass order placed",
  "3B": "Glass delivery",
  "3C1": "Aluminium framework",
  "3C2": "Installation",
  "3E": "Final quality check",
};

export function portalStepLabel(stepCode: string, fallback: string): string {
  return PORTAL_STEP_LABELS[stepCode] ?? fallback;
}

export const PORTAL_PHASE_LABELS: Record<StepPhase, string> = {
  phase_1: "Planning",
  phase_2: "Materials",
  phase_3: "Installation",
};

/**
 * "Blocked" is internal language, and the reason behind it (damaged sections, a vendor issue,
 * an unpaid invoice) is not something to put in front of a client unprompted — so a blocked step
 * reads as "On hold" here, with no reason attached. Everything else says what it says.
 */
export const PORTAL_STATUS_LABELS: Record<StepStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "On hold",
  completed: "Completed",
};

export const PORTAL_STATUS_STYLES: Record<StepStatus, { dot: string; text: string }> = {
  completed: { dot: "bg-[#2f6b4f]", text: "text-[#2f6b4f]" },
  in_progress: { dot: "bg-[#111111]", text: "text-[#111111]" },
  blocked: { dot: "bg-[#9a6b1f]", text: "text-[#9a6b1f]" },
  not_started: { dot: "bg-[rgba(17,17,17,0.22)]", text: "text-[rgba(17,17,17,0.45)]" },
};

export function formatPortalDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso)
  );
}

/** The one line of detail under a step: when it finished, or when it is expected to. */
export function portalStepDetail(step: {
  status: StepStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
}): string | null {
  if (step.status === "completed") {
    const done = formatPortalDate(step.actualEndDate);
    return done ? `Completed ${done}` : null;
  }
  if (step.status === "in_progress") {
    const due = formatPortalDate(step.plannedEndDate);
    return due ? `Expected by ${due}` : "Underway";
  }
  if (step.status === "blocked") {
    // Deliberately no date: an on-hold step's planned dates are the ones most likely to move,
    // and quoting one would read as a promise.
    return "Paused — our team will be in touch";
  }
  const starts = formatPortalDate(step.plannedStartDate);
  return starts ? `Planned from ${starts}` : null;
}
