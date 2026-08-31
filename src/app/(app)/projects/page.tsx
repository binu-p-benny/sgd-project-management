import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ProjectFilters } from "@/components/projects/ProjectFilters";
import { DeleteProjectButton } from "@/components/projects/DeleteProjectButton";
import { getEffectiveOverallStatus, projectHasOverrun, type EffectiveOverallStatus } from "@/lib/overrun";
import { buildAllStepCodes } from "@/lib/step-template";
import { getProjectActiveDepartments } from "@/lib/project-filters";
import {
  PHASE_LABELS,
  OVERALL_STATUS_LABELS,
  OVERALL_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
  DEPARTMENT_LABELS,
} from "@/lib/labels";
import type { Department, PaymentStatus, ProjectPhase } from "@prisma/client";

const STEP_NAME_BY_CODE = new Map(buildAllStepCodes().map((s) => [s.stepCode, s.stepName]));

/**
 * The earliest not-yet-completed step, by step_code — lexicographic order matches the
 * intended workflow sequence for every code in this schema (1A<1B<1C<1D, 2A<2D1<2D2<2F,
 * 3A<3B<3C1<3C2<3E), same convention StepProgressBar and step-actions.ts rely on. This is
 * the concrete process step a project is sitting at right now, one level more specific
 * than current_phase.
 */
function getCurrentStep(
  steps: {
    stepCode: string;
    stepName: string;
    status: string;
    owningDepartment: Department;
    secondaryDepartment: Department | null;
  }[]
): {
  stepCode: string;
  stepName: string;
  owningDepartment: Department;
  secondaryDepartment: Department | null;
} | null {
  const open = steps
    .filter((s) => s.status !== "completed")
    .sort((a, b) => a.stepCode.localeCompare(b.stepCode));
  return open[0] ?? null;
}

/** Small pill per department currently active on a project (see getProjectActiveDepartments) —
 *  "—" once nothing is (project fully wrapped up, payments included). Shared between the mobile
 *  card and desktop table layouts below. */
function DepartmentBadges({ departments }: { departments: Set<Department> }) {
  if (departments.size === 0) {
    return <span className="text-fg-subtle">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from(departments).map((d) => (
        <span
          key={d}
          className="rounded-full bg-overlay px-2 py-0.5 text-[11px] font-medium text-fg-muted ring-1 ring-inset ring-edge"
        >
          {DEPARTMENT_LABELS[d]}
        </span>
      ))}
    </div>
  );
}

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

// Pulled out of the component body: react-hooks/purity flags Date.now() called directly during
// render, even in a Server Component that only ever runs once per request.
function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

const ACTIVE_FILTER_LABEL: Record<string, (value: string) => string> = {
  phase: (v) => `Phase: ${PHASE_LABELS[v as ProjectPhase] ?? v}`,
  status: (v) => `Status: ${OVERALL_STATUS_LABELS[v as EffectiveOverallStatus] ?? v}`,
  department: (v) => `Currently with ${DEPARTMENT_LABELS[v as Department] ?? v}`,
  paymentStatus: (v) => `Payment: ${PAYMENT_STATUS_LABELS[v as PaymentStatus] ?? v}`,
  newDays: (v) => `Created in last ${v} days`,
  overdue: () => `Has an overdue step`,
  currentStep: (v) => `Current step: ${v}${STEP_NAME_BY_CODE.has(v) ? ` · ${STEP_NAME_BY_CODE.get(v)}` : ""}`,
};

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    phase?: string;
    status?: string;
    department?: string;
    paymentStatus?: string;
    newDays?: string;
    overdue?: string;
    currentStep?: string;
  }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  const canDelete = !!session && isAdminEditor(session);
  const phase = params.phase as ProjectPhase | undefined;
  const status = params.status as EffectiveOverallStatus | undefined;
  const department = params.department as Department | undefined;
  const paymentStatus = params.paymentStatus as PaymentStatus | undefined;
  const newDays = params.newDays ? Number(params.newDays) : undefined;
  const overdueOnly = params.overdue === "1";
  const currentStepFilter = params.currentStep;

  const rawProjects = await prisma.project.findMany({
    where: {
      ...(phase ? { currentPhase: phase } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
    },
    include: {
      phaseSteps: {
        select: {
          stepCode: true,
          stepName: true,
          plannedEndDate: true,
          status: true,
          owningDepartment: true,
          secondaryDepartment: true,
        },
      },
      procurementItems: {
        select: {
          itemType: true,
          expectedArrivalDate: true,
          actualArrivalDate: true,
          qcPassed: true,
          requirementCreatedAt: true,
          quoteCreatedAt: true,
          paymentSettledAt: true,
          orderConfirmedAt: true,
          materialDespatchAt: true,
          arrivedForPowderCoatingAt: true,
          qcCheckedAt: true,
        },
      },
      glassPurchaseOrder: {
        select: { requirementCreatedAt: true, quoteCreatedAt: true, paymentSettledAt: true, orderConfirmedAt: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  const newSince = newDays ? daysAgo(newDays) : undefined;

  // status=delayed, status=qc_failed, overdue=1 and department can't be stored-column filters —
  // none of them are event-driven (see overrun.ts) or a plain field match — so they're computed
  // and applied here in JS.
  const projects = rawProjects
    .map((p) => {
      const currentStep = getCurrentStep(p.phaseSteps);
      return {
        ...p,
        effectiveStatus: getEffectiveOverallStatus(
          p.overallStatus,
          projectHasOverrun(p.phaseSteps, p.procurementItems),
          p.procurementItems.some((i) => i.qcPassed === false)
        ),
        hasOverdue: projectHasOverrun(p.phaseSteps, p.procurementItems),
        currentStep,
        activeDepartments: getProjectActiveDepartments(
          currentStep,
          p.currentPhase !== "phase_1",
          p.procurementItems,
          p.glassPurchaseOrder
        ),
      };
    })
    .filter((p) => !status || p.effectiveStatus === status)
    .filter((p) => !newSince || p.createdAt >= newSince)
    .filter((p) => !overdueOnly || p.hasOverdue)
    .filter((p) => !currentStepFilter || p.currentStep?.stepCode === currentStepFilter)
    .filter((p) => !department || p.activeDepartments.has(department));

  const activeFilters = Object.entries(params).filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
              <rect x="4" y="5" width="16" height="15" rx="1.5" />
              <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
            </svg>
          </span>
          <h1 className="text-xl font-semibold text-fg">Projects</h1>
        </div>
        <Link
          href="/projects/new"
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-2"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} className="h-5 w-5 stroke-current">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New project
        </Link>
      </div>

      <ProjectFilters />

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {activeFilters.map(([key, value]) => (
            <span key={key} className="rounded-full bg-overlay px-3 py-1 text-xs font-medium text-fg-muted ring-1 ring-inset ring-edge">
              {ACTIVE_FILTER_LABEL[key]?.(value as string) ?? `${key}: ${value}`}
            </span>
          ))}
          <Link href="/projects" className="text-xs font-medium text-fg-muted underline hover:text-fg">
            Clear filters
          </Link>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge-2 py-10 text-center text-sm text-fg-muted">
          No projects match these filters.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {projects.map((project) => (
              // The delete control sits outside the Link rather than inside it — a button nested
              // in an anchor is invalid, and tapping it would otherwise also navigate.
              <div
                key={project.id}
                className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4 transition-colors hover:border-edge-2"
              >
                <Link href={`/projects/${project.id}`} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-fg">{project.name}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${OVERALL_STATUS_COLORS[project.effectiveStatus]}`}
                    >
                      {OVERALL_STATUS_LABELS[project.effectiveStatus]}
                    </span>
                  </div>
                  {project.clientName !== project.name && (
                    <div className="text-sm text-fg-muted">{project.clientName}</div>
                  )}
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-fg-muted">{PHASE_LABELS[project.currentPhase]}</span>
                    <span className="font-mono tabular-nums text-fg-muted">{formatINR(Number(project.finalCost))}</span>
                  </div>
                  <div className="text-xs leading-snug text-fg-subtle">
                    {project.currentStep ? (
                      <>
                        <span className="font-mono">{project.currentStep.stepCode}</span> {project.currentStep.stepName}
                      </>
                    ) : (
                      "Completed"
                    )}
                  </div>
                  <DepartmentBadges departments={project.activeDepartments} />
                  <div className="text-xs text-fg-subtle">Payment: {PAYMENT_STATUS_LABELS[project.paymentStatus]}</div>
                </Link>
                {canDelete && (
                  <div className="flex justify-end border-t border-edge pt-2">
                    <DeleteProjectButton projectId={project.id} projectName={project.name} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-edge sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface text-[11px] uppercase tracking-wider text-fg-subtle">
                <tr>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Phase</th>
                  <th className="w-56 px-4 py-3 font-medium">Current step</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium text-right">Final cost</th>
                  {canDelete && <th className="px-4 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {projects.map((project) => (
                  <tr key={project.id} className="cursor-pointer bg-surface transition-colors hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={`/projects/${project.id}`} className="flex flex-col gap-0.5">
                        <span className="font-medium text-fg hover:underline">{project.name}</span>
                        {project.clientName !== project.name && (
                          <span className="text-xs text-fg-muted">{project.clientName}</span>
                        )}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{PHASE_LABELS[project.currentPhase]}</td>
                    <td className="max-w-[14rem] px-4 py-3 text-fg-muted">
                      {project.currentStep ? (
                        <span className="leading-snug">
                          <span className="font-mono text-xs text-fg-subtle">{project.currentStep.stepCode}</span>{" "}
                          {project.currentStep.stepName}
                        </span>
                      ) : (
                        "Completed"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <DepartmentBadges departments={project.activeDepartments} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${OVERALL_STATUS_COLORS[project.effectiveStatus]}`}
                      >
                        {OVERALL_STATUS_LABELS[project.effectiveStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{PAYMENT_STATUS_LABELS[project.paymentStatus]}</td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-fg-muted">
                      {formatINR(Number(project.finalCost))}
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteProjectButton projectId={project.id} projectName={project.name} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
