import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ProjectFilters } from "@/components/projects/ProjectFilters";
import { DeleteProjectButton } from "@/components/projects/DeleteProjectButton";
import { getEffectiveOverallStatus, projectHasOverrun } from "@/lib/overrun";
import {
  PHASE_LABELS,
  OVERALL_STATUS_LABELS,
  OVERALL_STATUS_COLORS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/labels";
import type { Department, OverallStatus, PaymentStatus, ProjectPhase } from "@prisma/client";

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

const ACTIVE_FILTER_LABEL: Record<string, (value: string) => string> = {
  phase: (v) => `Phase: ${PHASE_LABELS[v as ProjectPhase] ?? v}`,
  status: (v) => `Status: ${OVERALL_STATUS_LABELS[v as OverallStatus] ?? v}`,
  department: (v) => `Department: ${v.replace("_", " ")}`,
  paymentStatus: (v) => `Payment: ${PAYMENT_STATUS_LABELS[v as PaymentStatus] ?? v}`,
  newDays: (v) => `Created in last ${v} days`,
  overdue: () => `Has an overdue step`,
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
  }>;
}) {
  const params = await searchParams;
  const session = await getSession();
  const canDelete = !!session && isAdminEditor(session);
  const phase = params.phase as ProjectPhase | undefined;
  const status = params.status as OverallStatus | undefined;
  const department = params.department as Department | undefined;
  const paymentStatus = params.paymentStatus as PaymentStatus | undefined;
  const newDays = params.newDays ? Number(params.newDays) : undefined;
  const overdueOnly = params.overdue === "1";

  const rawProjects = await prisma.project.findMany({
    where: {
      ...(phase ? { currentPhase: phase } : {}),
      ...(department ? { phaseSteps: { some: { owningDepartment: department } } } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
    },
    include: {
      phaseSteps: { select: { plannedEndDate: true, status: true } },
      procurementItems: { select: { expectedArrivalDate: true, actualArrivalDate: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const newSince = newDays ? new Date(Date.now() - newDays * 24 * 60 * 60 * 1000) : undefined;

  // status=delayed and overdue=1 can't be stored-column filters — both are date-driven,
  // not event-driven (see overrun.ts) — so they're computed and applied here in JS.
  const projects = rawProjects
    .map((p) => ({
      ...p,
      effectiveStatus: getEffectiveOverallStatus(p.overallStatus, projectHasOverrun(p.phaseSteps, p.procurementItems)),
      hasOverdue: projectHasOverrun(p.phaseSteps, p.procurementItems),
    }))
    .filter((p) => !status || p.effectiveStatus === status)
    .filter((p) => !newSince || p.createdAt >= newSince)
    .filter((p) => !overdueOnly || p.hasOverdue);

  const activeFilters = Object.entries(params).filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold text-fg">Projects</h1>
        <Link
          href="/projects/new"
          className="flex h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-2"
        >
          + New project
        </Link>
      </div>

      <ProjectFilters />

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {activeFilters.map(([key, value]) => (
            <span key={key} className="rounded-full bg-white/[0.06] px-3 py-1 text-xs font-medium text-fg-muted ring-1 ring-inset ring-white/10">
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
                  <div className="text-sm text-fg-muted">{project.clientName}</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-fg-muted">{PHASE_LABELS[project.currentPhase]}</span>
                    <span className="font-mono tabular-nums text-fg-muted">{formatINR(Number(project.finalCost))}</span>
                  </div>
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
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Phase</th>
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
                      <Link href={`/projects/${project.id}`} className="font-medium text-fg hover:underline">
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{project.clientName}</td>
                    <td className="px-4 py-3 text-fg-muted">{PHASE_LABELS[project.currentPhase]}</td>
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
