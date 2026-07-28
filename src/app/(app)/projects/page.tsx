import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { ProjectFilters } from "@/components/projects/ProjectFilters";
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
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Projects</h1>
        <Link
          href="/projects/new"
          className="flex h-11 items-center justify-center rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          + New project
        </Link>
      </div>

      <ProjectFilters />

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {activeFilters.map(([key, value]) => (
            <span
              key={key}
              className="rounded-full bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
            >
              {ACTIVE_FILTER_LABEL[key]?.(value as string) ?? `${key}: ${value}`}
            </span>
          ))}
          <Link href="/projects" className="text-xs font-medium text-zinc-500 underline dark:text-zinc-400">
            Clear filters
          </Link>
        </div>
      )}

      {projects.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No projects match these filters.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {projects.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                className="flex flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-zinc-900 dark:text-zinc-50">{project.name}</span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${OVERALL_STATUS_COLORS[project.effectiveStatus]}`}
                  >
                    {OVERALL_STATUS_LABELS[project.effectiveStatus]}
                  </span>
                </div>
                <div className="text-sm text-zinc-500 dark:text-zinc-400">{project.clientName}</div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-600 dark:text-zinc-300">{PHASE_LABELS[project.currentPhase]}</span>
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {formatINR(Number(project.finalCost))}
                  </span>
                </div>
                <div className="text-xs text-zinc-400 dark:text-zinc-500">
                  Payment: {PAYMENT_STATUS_LABELS[project.paymentStatus]}
                </div>
              </Link>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-zinc-200 sm:block dark:border-zinc-800">
            <table className="w-full text-left text-sm">
              <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Phase</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Payment</th>
                  <th className="px-4 py-3 font-medium text-right">Final cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {projects.map((project) => (
                  <tr
                    key={project.id}
                    className="cursor-pointer bg-white hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800/60"
                  >
                    <td className="px-4 py-3">
                      <Link href={`/projects/${project.id}`} className="font-medium text-zinc-900 hover:underline dark:text-zinc-50">
                        {project.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{project.clientName}</td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">{PHASE_LABELS[project.currentPhase]}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${OVERALL_STATUS_COLORS[project.effectiveStatus]}`}
                      >
                        {OVERALL_STATUS_LABELS[project.effectiveStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-zinc-600 dark:text-zinc-300">
                      {PAYMENT_STATUS_LABELS[project.paymentStatus]}
                    </td>
                    <td className="px-4 py-3 text-right text-zinc-600 dark:text-zinc-300">
                      {formatINR(Number(project.finalCost))}
                    </td>
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
