import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ProcurementTracker } from "@/components/procurement/ProcurementTracker";
import { PaymentEditor } from "@/components/projects/PaymentEditor";
import { StepProgressBar } from "@/components/projects/StepProgressBar";
import { TaskCard } from "@/components/my-tasks/TaskCard";
import { getMyTasks, type MyTaskItem } from "@/lib/my-tasks";
import { getBlockerHistory } from "@/lib/blocker-history";
import { isStepOverrun, isProcurementItemOverrun, getEffectiveOverallStatus, projectHasOverrun } from "@/lib/overrun";
import {
  PHASE_LABELS,
  OVERALL_STATUS_LABELS,
  OVERALL_STATUS_COLORS,
  STEP_STATUS_LABELS,
  STEP_STATUS_COLORS,
  DEPARTMENT_LABELS,
  BLOCKED_REASON_LABELS,
} from "@/lib/labels";
import type { ItemType, PhaseStep, StepPhase } from "@prisma/client";

// Fixed display order for procurement cards — matters because Postgres makes no row-order
// guarantee without an ORDER BY, and these rows get updated (not just read) on every
// checkbox toggle, so relying on insertion/scan order lets the cards visibly reshuffle.
const ITEM_TYPE_ORDER: Record<ItemType, number> = { section: 0, hardware: 1, gasket: 2 };

// Procurement sits inline within Phase 2's cards, right before 2D1 ("Materials arrived") —
// that's the step it actually drives, so seeing the checkboxes right above it reads better
// than the tracker appearing after the whole phase 1+2 block.
const MATERIALS_ARRIVED_STEP_CODE = "2D1";

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

const PHASE_ORDER: StepPhase[] = ["phase_1", "phase_2", "phase_3"];

function EditablePhaseGroup({
  phase,
  items,
  insertBeforeStepCode,
  insertContent,
}: {
  phase: StepPhase;
  items: MyTaskItem[];
  /** Step code to split this phase's cards at, so e.g. Procurement can sit between 2A and 2D1. */
  insertBeforeStepCode?: string;
  insertContent?: ReactNode;
}) {
  const splitIndex = insertBeforeStepCode
    ? items.findIndex((item) => item.stepCode === insertBeforeStepCode)
    : -1;
  const before = splitIndex === -1 ? items : items.slice(0, splitIndex);
  const after = splitIndex === -1 ? [] : items.slice(splitIndex);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{PHASE_LABELS[phase]}</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {before.map((item) => (
            <TaskCard key={item.id} item={item} canEditDates canRevert showDepartment />
          ))}
        </div>
      </div>
      {insertContent}
      {after.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {after.map((item) => (
            <TaskCard key={item.id} item={item} canEditDates canRevert showDepartment />
          ))}
        </div>
      )}
    </div>
  );
}

function ReadOnlyStepRow({ step }: { step: PhaseStep }) {
  return (
    <div className="flex flex-col gap-1.5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <span className="font-mono text-xs text-fg-subtle">{step.stepCode}</span>{" "}
          <span className="font-medium text-fg">{step.stepName}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STEP_STATUS_COLORS[step.status]}`}>
            {STEP_STATUS_LABELS[step.status]}
          </span>
          {isStepOverrun(step.plannedEndDate, step.status) && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/25">
              Overdue
            </span>
          )}
        </div>
      </div>
      <div className="text-xs text-fg-muted">
        {DEPARTMENT_LABELS[step.owningDepartment]}
        {step.secondaryDepartment ? ` + ${DEPARTMENT_LABELS[step.secondaryDepartment]}` : ""}
        {" · "}
        Planned {formatDate(step.plannedStartDate)} – {formatDate(step.plannedEndDate)}
      </div>
      {step.status === "blocked" && step.blockedReason && (
        <div className="mt-1 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-inset ring-red-500/25">
          Blocked: {BLOCKED_REASON_LABELS[step.blockedReason]}
          {step.blockedNote ? ` — ${step.blockedNote}` : ""}
        </div>
      )}
      {step.notes && (
        <div className="rounded-lg bg-white/[0.06] px-3 py-2 text-xs italic text-fg-muted">
          &ldquo;{step.notes}&rdquo;
        </div>
      )}
    </div>
  );
}

function ReadOnlyPhaseGroup({
  phase,
  steps,
  insertBeforeStepCode,
  insertContent,
}: {
  phase: StepPhase;
  steps: PhaseStep[];
  /** Step code to split this phase's cards at, so e.g. Procurement can sit between 2A and 2D1. */
  insertBeforeStepCode?: string;
  insertContent?: ReactNode;
}) {
  const splitIndex = insertBeforeStepCode
    ? steps.findIndex((step) => step.stepCode === insertBeforeStepCode)
    : -1;
  const before = splitIndex === -1 ? steps : steps.slice(0, splitIndex);
  const after = splitIndex === -1 ? [] : steps.slice(splitIndex);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">{PHASE_LABELS[phase]}</h3>
        <div className="flex flex-col divide-y divide-edge rounded-xl border border-edge bg-surface">
          {before.map((step) => (
            <ReadOnlyStepRow key={step.id} step={step} />
          ))}
        </div>
      </div>
      {insertContent}
      {after.length > 0 && (
        <div className="flex flex-col divide-y divide-edge rounded-xl border border-edge bg-surface">
          {after.map((step) => (
            <ReadOnlyStepRow key={step.id} step={step} />
          ))}
        </div>
      )}
    </div>
  );
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession();

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      // createdAt alone isn't a stable sort: steps within a phase are batch-inserted
      // via createMany and can share the same millisecond timestamp. stepCode as a
      // tiebreaker happens to sort correctly for every code in this schema (1A<1B<1C<1D,
      // 2A<2D1<2D2<2F, 3A<3B<3C1<3C2<3E — lexicographic order matches intended sequence).
      phaseSteps: { orderBy: [{ createdAt: "asc" }, { stepCode: "asc" }] },
      procurementItems: true,
    },
  });

  if (!project) notFound();

  const blockerHistory = await getBlockerHistory(id);
  const canEditEverything = !!session && isAdminEditor(session);

  const effectiveStatus = getEffectiveOverallStatus(
    project.overallStatus,
    projectHasOverrun(project.phaseSteps, project.procurementItems)
  );

  const stepsByPhase = PHASE_ORDER.map((phase) => ({
    phase,
    steps: project.phaseSteps.filter((s) => s.phase === phase),
  })).filter((group) => group.steps.length > 0);

  // Admin editors (owner_admin, HR & Admin) get the full editable timeline — status
  // transitions including block/unblock-with-message, plus direct date overrides.
  // Everyone else keeps the plain read-only rows below.
  const editableSteps = canEditEverything
    ? await getMyTasks(null, { projectId: id, includeCompleted: true, sortBy: "stepCode" })
    : [];
  const editableStepsByPhase = PHASE_ORDER.map((phase) => ({
    phase,
    items: editableSteps.filter((s) => s.phase === phase),
  })).filter((group) => group.items.length > 0);

  const beforePhase3 = stepsByPhase.filter((g) => g.phase !== "phase_3");
  const phase3Only = stepsByPhase.filter((g) => g.phase === "phase_3");
  const editableBeforePhase3 = editableStepsByPhase.filter((g) => g.phase !== "phase_3");
  const editablePhase3Only = editableStepsByPhase.filter((g) => g.phase === "phase_3");

  const procurementTracker = (
    <ProcurementTracker
      canEdit={!!session && (isAdminEditor(session) || session.department === "purchase")}
      canEditRequirement={!!session && session.department === "design_engineer"}
      items={[...project.procurementItems]
        .sort((a, b) => ITEM_TYPE_ORDER[a.itemType] - ITEM_TYPE_ORDER[b.itemType])
        .map((item) => ({
        id: item.id,
        itemType: item.itemType,
        requirementCreatedAt: item.requirementCreatedAt?.toISOString() ?? null,
        quoteCreatedAt: item.quoteCreatedAt?.toISOString() ?? null,
        orderConfirmedAt: item.orderConfirmedAt?.toISOString() ?? null,
        paymentSettledAt: item.paymentSettledAt?.toISOString() ?? null,
        paymentDetails: item.paymentDetails,
        expectedArrivalDate: item.expectedArrivalDate?.toISOString() ?? null,
        actualArrivalDate: item.actualArrivalDate?.toISOString() ?? null,
        qcCheckedAt: item.qcCheckedAt?.toISOString() ?? null,
        overrun: isProcurementItemOverrun(item.expectedArrivalDate, item.actualArrivalDate),
        notes: item.notes,
      }))}
    />
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-5 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-fg">{project.name}</h1>
            <p className="text-sm text-fg-muted">
              {project.clientName} · {project.clientPhone}
            </p>
            <p className="text-sm text-fg-muted">{project.clientAddress}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span
              className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${OVERALL_STATUS_COLORS[effectiveStatus]}`}
            >
              {OVERALL_STATUS_LABELS[effectiveStatus]}
            </span>
            {canEditEverything && (
              <Link
                href={`/projects/${project.id}/edit`}
                className="flex h-8 items-center justify-center rounded-lg border border-edge px-3 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-white/[0.04] hover:text-fg"
              >
                Edit project
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-edge pt-4 text-sm sm:grid-cols-4">
          <div>
            <div className="text-fg-subtle">Phase</div>
            <div className="font-medium text-fg">{PHASE_LABELS[project.currentPhase]}</div>
          </div>
          <div>
            <div className="text-fg-subtle">Glass type</div>
            <div className="font-medium capitalize text-fg">{project.glassType}</div>
          </div>
          <div>
            <div className="text-fg-subtle">Final cost</div>
            <div className="font-mono font-medium tabular-nums text-fg">{formatINR(Number(project.finalCost))}</div>
          </div>
          <PaymentEditor
            projectId={project.id}
            paymentStatus={project.paymentStatus}
            amountReceived={Number(project.amountReceived)}
            finalCost={Number(project.finalCost)}
            notes={project.notes}
            canEdit={!!session && (isAdminEditor(session) || session.department === "accounts")}
          />
        </div>
      </div>

      <StepProgressBar steps={project.phaseSteps} />

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-fg">Step timeline</h2>
          {canEditEverything && (
            <span className="text-xs text-fg-subtle">Editable — status, blocking, dates, and revert</span>
          )}
        </div>

        {canEditEverything
          ? editableBeforePhase3.map(({ phase, items }) => (
              <EditablePhaseGroup
                key={phase}
                phase={phase}
                items={items}
                insertBeforeStepCode={phase === "phase_2" ? MATERIALS_ARRIVED_STEP_CODE : undefined}
                insertContent={phase === "phase_2" ? procurementTracker : undefined}
              />
            ))
          : beforePhase3.map(({ phase, steps }) => (
              <ReadOnlyPhaseGroup
                key={phase}
                phase={phase}
                steps={steps}
                insertBeforeStepCode={phase === "phase_2" ? MATERIALS_ARRIVED_STEP_CODE : undefined}
                insertContent={phase === "phase_2" ? procurementTracker : undefined}
              />
            ))}
      </div>

      {(canEditEverything ? editablePhase3Only.length > 0 : phase3Only.length > 0) && (
        <div className="flex flex-col gap-4">
          {canEditEverything
            ? editablePhase3Only.map(({ phase, items }) => <EditablePhaseGroup key={phase} phase={phase} items={items} />)
            : phase3Only.map(({ phase, steps }) => <ReadOnlyPhaseGroup key={phase} phase={phase} steps={steps} />)}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold text-fg">Blocker history</h2>
        {blockerHistory.length === 0 ? (
          <p className="rounded-lg border border-dashed border-edge-2 py-8 text-center text-sm text-fg-muted">
            This project has never been blocked.
          </p>
        ) : (
          <div className="flex flex-col divide-y divide-edge rounded-xl border border-edge bg-surface">
            {blockerHistory.map((entry, i) => (
              <div key={i} className="flex flex-col gap-1 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-mono text-xs text-fg-subtle">{entry.stepCode}</span>{" "}
                    <span className="font-medium text-fg">{entry.stepName}</span>
                  </div>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-xs font-medium tabular-nums ${
                      entry.resolvedAt
                        ? "bg-white/[0.06] text-fg-muted ring-1 ring-inset ring-white/10"
                        : "bg-red-500/10 text-red-400 ring-1 ring-inset ring-red-500/25"
                    }`}
                  >
                    {entry.resolvedAt ? `Resolved in ${entry.durationDays}d` : `Ongoing · ${entry.durationDays}d`}
                  </span>
                </div>
                {entry.reason && <div className="text-fg-muted">{entry.reason}</div>}
                <div className="text-xs text-fg-subtle">
                  Blocked by {entry.blockedBy} on {formatDateTime(entry.blockedAt)}
                  {entry.resolvedAt && ` · resolved ${formatDateTime(entry.resolvedAt)}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
