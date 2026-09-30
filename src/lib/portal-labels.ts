import type { BlockedReason, StepPhase, StepStatus } from "@prisma/client";
import { BLOCKED_REASON_LABELS } from "@/lib/labels";

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
  "2D2": "Final measurement at site",
  "2F": "Material quality check",
  "3A": "Glass order placed",
  "3B": "Glass delivery",
  // 3C1/3C2 are each split into their own start/end nodes (see buildSplitStepPair in
  // client-portal.ts) rather than shown as one node — a framework/installation visit is long
  // enough that a client wants to know it started, not just that it eventually finished.
  "3C1-START": "Aluminium framework start",
  "3C1-END": "Aluminium framework end",
  "3C2-START": "Installation start",
  "3C2-END": "Installation end",
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

export const PORTAL_PHASE_NUMBERS: Record<StepPhase, number> = {
  phase_1: 1,
  phase_2: 2,
  phase_3: 3,
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
  /** Set only when status is "blocked" — named to the client so they know what's being worked. */
  blockedReason?: BlockedReason | null;
  /**
   * True for a step whose planned date is a rough estimate rather than a firm commitment (the
   * Installation start/end nodes) — shown as "Approximate: <date>" instead of "from"/"by".
   */
  datesAreEstimates?: boolean;
}

function blockedMessage(step: PortalStepDates): string {
  const reason = step.blockedReason ? BLOCKED_REASON_LABELS[step.blockedReason] : null;
  return reason
    ? `Currently blocked due to ${reason} — team will contact you`
    : "Currently blocked — team will contact you";
}

/** The one short line under a timeline node — a date wherever there is one to give. */
export function portalStepNote(step: PortalStepDates): string | null {
  if (step.status === "completed") return formatPortalDateShort(step.actualEndDate);
  if (step.status === "blocked") return blockedMessage(step);
  if (step.status === "in_progress") {
    const due = formatPortalDateShort(step.plannedEndDate);
    if (!due) return "underway";
    return step.datesAreEstimates ? `Approximate: ${due}` : `by ${due}`;
  }
  const starts = formatPortalDateShort(step.plannedStartDate);
  if (!starts) return null;
  return step.datesAreEstimates ? `Approximate: ${starts}` : `from ${starts}`;
}

/** The full sentence, kept for the node's hover title where there's room for it. */
export function portalStepTitle(name: string, step: PortalStepDates): string {
  const status = PORTAL_STATUS_LABELS[step.status];
  if (step.status === "completed") {
    const done = formatPortalDate(step.actualEndDate);
    return done ? `${name} — completed ${done}` : `${name} — ${status}`;
  }
  if (step.status === "blocked") return `${name} — ${blockedMessage(step)}`;
  if (step.status === "in_progress") {
    const due = formatPortalDate(step.plannedEndDate);
    if (!due) return `${name} — in progress`;
    return step.datesAreEstimates
      ? `${name} — in progress, approximately ${due}`
      : `${name} — in progress, expected by ${due}`;
  }
  const starts = formatPortalDate(step.plannedStartDate);
  if (!starts) return `${name} — ${status}`;
  return step.datesAreEstimates ? `${name} — approximately ${starts}` : `${name} — planned from ${starts}`;
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
  // 2A/2D1 are no longer listed: the material chain (order confirmed -> dispatched -> arrived for
  // powder coating -> materials arrived), built from the section procurement item in
  // client-portal.ts, replaces them on screen. 2D2/2F still come from real PhaseStep rows.
  phase_2: ["2D2", "2F"],
  phase_3: ["3A", "3B", "3C1-START", "3C1-END", "3C2-START", "3C2-END", "3E"],
};
