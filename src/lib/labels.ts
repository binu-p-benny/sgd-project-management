import type {
  Department,
  PaymentStatus,
  ProjectPhase,
  StepPhase,
  StepStatus,
  BlockedReason,
  DelayCategory,
} from "@prisma/client";
import type { EffectiveOverallStatus } from "@/lib/overrun";
import type { ServiceStatus } from "@/lib/service";

export const DEPARTMENT_LABELS: Record<Department, string> = {
  hr_admin: "HR & Admin",
  project_engineer: "Project Engineer",
  design_engineer: "Design Engineer",
  purchase: "Purchase",
  accounts: "Accounts",
  owner_admin: "Owner / Admin",
  operations_manager: "Operations Manager",
};

// Every department a task can be assigned to — every dropdown that offers "who owns this work"
// (action items, service rows, work-block tasks, planned-date delegation, admin/task-list
// filters) reads from this one shared list. Owner and Operations Manager are full members: like
// any other department, they can be handed a task and mark it done from their own /my-tasks
// (see MyTasksPage) — this isn't the same list as department-kpi-report.ts' own KPI_DEPARTMENTS,
// which still excludes owner_admin from the performance leaderboard on purpose.
// `as const satisfies` (not `: Department[]`) so this is also a non-empty tuple of literal
// strings — the shape z.enum() needs directly, with no runtime array to keep in sync by hand.
export const ASSIGNABLE_DEPARTMENTS = [
  "hr_admin",
  "project_engineer",
  "design_engineer",
  "purchase",
  "accounts",
  "owner_admin",
  "operations_manager",
] as const satisfies readonly Department[];

export const PHASE_LABELS: Record<ProjectPhase, string> = {
  phase_1: "Phase 1 · Onboarding",
  phase_2: "Phase 2 · Procurement",
  phase_3: "Phase 3 · Installation",
  completed: "Completed",
};

export const OVERALL_STATUS_LABELS: Record<EffectiveOverallStatus, string> = {
  on_track: "On track",
  delayed: "Delayed",
  blocked: "Blocked",
  completed: "Completed",
  qc_failed: "QC failed",
};

export const OVERALL_STATUS_COLORS: Record<EffectiveOverallStatus, string> = {
  on_track: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
  delayed: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25",
  blocked: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25",
  completed: "bg-overlay text-fg-muted ring-1 ring-inset ring-edge",
  // Distinct from blocked's red — a QC failure is a specific, correctable gate, not a generic
  // "someone reported a blocker" state, and the two shouldn't be visually indistinguishable.
  qc_failed: "bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/25",
};

export const SERVICE_STATUS_LABELS: Record<ServiceStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  delayed: "Delayed",
  completed: "Completed",
  review_not_completed: "Review not completed",
};

// Same on_track/delayed/completed color triple as OVERALL_STATUS_COLORS — in_progress here
// plays on_track's role (emerald: actively moving, nothing overdue), and completed is
// deliberately neutral rather than green, same "it's over, not a thing to celebrate on a badge"
// reasoning Project's own completed color already uses. review_not_completed borrows the
// customer review card's own fuchsia accent (see ServiceReviewCard) so the badge visually
// points at where to go fix it.
export const SERVICE_STATUS_COLORS: Record<ServiceStatus, string> = {
  not_started: "bg-overlay text-fg-muted ring-1 ring-inset ring-edge",
  in_progress: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
  delayed: "bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-400 dark:ring-amber-500/25",
  completed: "bg-overlay text-fg-muted ring-1 ring-inset ring-edge",
  review_not_completed: "bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200 dark:bg-fuchsia-500/10 dark:text-fuchsia-400 dark:ring-fuchsia-500/25",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  partial: "Partial",
  received: "Received",
};

export const STEP_STATUS_LABELS: Record<StepStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  blocked: "Blocked",
  completed: "Completed",
};

/**
 * Display-only override: "Blocked" reads as a dead end, but past Phase 1 most blockers (a
 * damaged part, a vendor issue) get worked around rather than sitting until someone manually
 * unblocks the step, so the badge says "Temporarily blocked" instead once the step is in Phase
 * 2/3. Front-end wording only — the stored status is still "blocked" either way, and
 * STEP_STATUS_COLORS/STEP_STATUS_LABELS are unaffected.
 */
export function stepStatusLabel(status: StepStatus, phase: StepPhase | string): string {
  if (status === "blocked" && phase !== "phase_1") return "Temporarily blocked";
  return STEP_STATUS_LABELS[status];
}

export const STEP_STATUS_COLORS: Record<StepStatus, string> = {
  not_started: "bg-overlay text-fg-muted ring-1 ring-inset ring-edge",
  in_progress: "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-200 dark:bg-blue-500/10 dark:text-blue-400 dark:ring-blue-500/25",
  blocked: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25",
  completed: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400 dark:ring-emerald-500/25",
};

export const BLOCKED_REASON_LABELS: Record<BlockedReason, string> = {
  client_payment_hold: "Client payment hold",
  client_hold: "Client hold (general)",
  site_not_ready: "Site not ready",
  section_damage: "Section damage",
  powder_coating_damage: "Powder coating damage",
  section_and_powder_coating_damage: "Section + powder coating damage",
  hardware_damage: "Hardware damage",
  glass_damage: "Glass damage",
  requirement_wrong_section: "Wrong requirement — section",
  requirement_wrong_hardware: "Wrong requirement — hardware",
  requirement_wrong_gasket: "Wrong requirement — gasket",
  requirement_wrong_glass: "Wrong requirement — glass",
  vendor_issue_section: "Vendor issue — section",
  vendor_issue_hardware: "Vendor issue — hardware",
  vendor_issue_gasket: "Vendor issue — gasket",
  vendor_issue_glass: "Vendor issue — glass",
  fabrication_damage_section: "Fabrication damage — section",
  fabrication_damage_hardware: "Fabrication damage — hardware",
  fabrication_damage_glass: "Fabrication damage — glass",
  transportation_damage_section: "Transportation damage — section",
  transportation_damage_hardware: "Transportation damage — hardware",
  transportation_damage_glass: "Transportation damage — glass",
  wrong_tight_measurement: "Wrong tight measurement",
  other: "Other",
};

export const BLOCKED_REASON_OPTIONS: BlockedReason[] = Object.keys(
  BLOCKED_REASON_LABELS
) as BlockedReason[];

export const DELAY_CATEGORY_LABELS: Record<DelayCategory, string> = {
  client_side: "Client side delay",
  in_house: "In house delay",
};

export const DELAY_CATEGORY_OPTIONS: DelayCategory[] = Object.keys(
  DELAY_CATEGORY_LABELS
) as DelayCategory[];
