import type {
  Department,
  OverallStatus,
  PaymentStatus,
  ProjectPhase,
  StepStatus,
  BlockedReason,
} from "@prisma/client";

export const DEPARTMENT_LABELS: Record<Department, string> = {
  hr_admin: "HR & Admin",
  project_engineer: "Project Engineer",
  design_engineer: "Design Engineer",
  purchase: "Purchase",
  accounts: "Accounts",
  owner_admin: "Owner / Admin",
};

export const PHASE_LABELS: Record<ProjectPhase, string> = {
  phase_1: "Phase 1 · Onboarding",
  phase_2: "Phase 2 · Procurement",
  phase_3: "Phase 3 · Installation",
  completed: "Completed",
};

export const OVERALL_STATUS_LABELS: Record<OverallStatus, string> = {
  on_track: "On track",
  delayed: "Delayed",
  blocked: "Blocked",
  completed: "Completed",
};

export const OVERALL_STATUS_COLORS: Record<OverallStatus, string> = {
  on_track: "bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/25",
  delayed: "bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/25",
  blocked: "bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/25",
  completed: "bg-white/[0.06] text-fg-muted ring-1 ring-inset ring-white/10",
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

export const STEP_STATUS_COLORS: Record<StepStatus, string> = {
  not_started: "bg-white/[0.06] text-fg-muted ring-1 ring-inset ring-white/10",
  in_progress: "bg-blue-500/10 text-blue-400 ring-1 ring-inset ring-blue-500/25",
  blocked: "bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/25",
  completed: "bg-emerald-500/10 text-emerald-400 ring-1 ring-inset ring-emerald-500/25",
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
