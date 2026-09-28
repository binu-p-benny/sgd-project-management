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

/**
 * Node colours for the phase timeline. Ink carries "happening now" and green "done", the way the
 * staff overview uses blue and green — kept to two hues plus one amber so the portal still reads
 * as the monochrome public site rather than a status dashboard.
 */
export const PORTAL_STATUS_STYLES: Record<StepStatus, { node: string; text: string; connector: string }> = {
  completed: { node: "border-[#2f6b4f] bg-[#2f6b4f]", text: "text-[#2f6b4f]", connector: "bg-[#2f6b4f]" },
  in_progress: { node: "border-[#111111] bg-[#111111]", text: "text-[#111111]", connector: "bg-[rgba(17,17,17,0.18)]" },
  blocked: { node: "border-[#9a6b1f] bg-[#9a6b1f]", text: "text-[#9a6b1f]", connector: "bg-[rgba(17,17,17,0.18)]" },
  not_started: {
    node: "border-[rgba(17,17,17,0.22)] bg-[#eae8e3]",
    text: "text-[rgba(17,17,17,0.45)]",
    connector: "bg-[rgba(17,17,17,0.18)]",
  },
};

export function formatPortalDate(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso)
  );
}

/** "17 Sept" — the timeline is tight, so the year only appears in the hover title. */
export function formatPortalDateShort(iso: string | null): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(iso));
}

export interface PortalStepDates {
  status: StepStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
}

/** The one short line under a timeline node — a date wherever there is one to give. */
export function portalStepNote(step: PortalStepDates): string | null {
  if (step.status === "completed") return formatPortalDateShort(step.actualEndDate);
  if (step.status === "in_progress") {
    const due = formatPortalDateShort(step.plannedEndDate);
    return due ? `by ${due}` : "underway";
  }
  // Deliberately no date on hold: those planned dates are the ones most likely to move, and
  // quoting one would read as a promise.
  if (step.status === "blocked") return "on hold";
  const starts = formatPortalDateShort(step.plannedStartDate);
  return starts ? `from ${starts}` : null;
}

/** The full sentence, kept for the node's hover title where there's room for it. */
export function portalStepTitle(name: string, step: PortalStepDates): string {
  const status = PORTAL_STATUS_LABELS[step.status];
  if (step.status === "completed") {
    const done = formatPortalDate(step.actualEndDate);
    return done ? `${name} — completed ${done}` : `${name} — ${status}`;
  }
  if (step.status === "in_progress") {
    const due = formatPortalDate(step.plannedEndDate);
    return due ? `${name} — in progress, expected by ${due}` : `${name} — in progress`;
  }
  if (step.status === "blocked") return `${name} — paused, our team will be in touch`;
  const starts = formatPortalDate(step.plannedStartDate);
  return starts ? `${name} — planned from ${starts}` : `${name} — ${status}`;
}

/**
 * The steps each phase is made of, in order. A project only gets its Phase 3 rows seeded when it
 * actually reaches Phase 3 (29 of the 42 live projects have none yet), so without this the
 * portal would simply stop after Materials and a client would have no idea installation was
 * still to come. getPortalProjects fills a missing phase from this list as not-started steps
 * with no dates — what is planned, not what has happened.
 */
export const PORTAL_PHASE_STEP_CODES: Record<StepPhase, string[]> = {
  phase_1: ["1A", "1B", "1C", "1D"],
  phase_2: ["2A", "2D1", "2D2", "2F"],
  phase_3: ["3A", "3B", "3C1", "3C2", "3E"],
};
