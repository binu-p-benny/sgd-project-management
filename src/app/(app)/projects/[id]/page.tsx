import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ProcurementTracker } from "@/components/procurement/ProcurementTracker";
import { GlassTracker, type GlassStageData } from "@/components/glass/GlassTracker";
import { SiteQCTracker } from "@/components/projects/SiteQCTracker";
import { PaymentEditor } from "@/components/projects/PaymentEditor";
import { PhaseReviewCard } from "@/components/projects/PhaseReviewCard";
import { StepProgressBar } from "@/components/projects/StepProgressBar";
import { TaskCard } from "@/components/my-tasks/TaskCard";
import { getMyTasks, type MyTaskItem } from "@/lib/my-tasks";
import { getBlockerHistory } from "@/lib/blocker-history";
import { isStepOverrun, isProcurementStageOverrun, getEffectiveOverallStatus, projectHasOverrun } from "@/lib/overrun";
import {
  computeProcurementPlannedDates,
  computeExpectedActionPlanDate,
  computeSectionChainDates,
  computeHardwareGasketChainDates,
  computeItemArrivalPlanned,
  computeSectionQCPlanned,
  computePhase2PlanAnchor,
} from "@/lib/procurement";
import { findUpstreamDelay } from "@/lib/reschedule";
import { maybeEarlyUnlockPhase3 } from "@/lib/step-actions";
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
  appendToBeforeGrid,
  appendToAfterGrid,
}: {
  phase: StepPhase;
  items: MyTaskItem[];
  /** Step code to split this phase's cards at, so e.g. Procurement can sit between 2A and 2D1. */
  insertBeforeStepCode?: string;
  insertContent?: ReactNode;
  /** Rendered as one more card inside the "before" grid itself (not a full-width block between
   *  grids, unlike insertContent) — so it fills whatever empty columns are left in that row on
   *  wide screens, e.g. sitting right next to 1D instead of pushing a new row underneath it. */
  appendToBeforeGrid?: ReactNode;
  /** Same idea as appendToBeforeGrid, but inside the "after" grid — for a phase that also has an
   *  insertBeforeStepCode split (e.g. sitting next to 3E, after Glass PO's own insertContent). */
  appendToAfterGrid?: ReactNode;
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
          {appendToBeforeGrid}
        </div>
      </div>
      {insertContent}
      {after.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {after.map((item) => (
            <TaskCard key={item.id} item={item} canEditDates canRevert showDepartment />
          ))}
          {appendToAfterGrid}
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
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-inset ring-amber-500/25 dark:text-amber-400">
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
        <div className="mt-1 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
          Blocked: {BLOCKED_REASON_LABELS[step.blockedReason]}
          {step.blockedNote ? ` — ${step.blockedNote}` : ""}
        </div>
      )}
      {step.notes && (
        <div className="rounded-lg bg-overlay px-3 py-2 text-xs italic text-fg-muted">
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
  trailingContent,
}: {
  phase: StepPhase;
  steps: PhaseStep[];
  /** Step code to split this phase's cards at, so e.g. Procurement can sit between 2A and 2D1. */
  insertBeforeStepCode?: string;
  insertContent?: ReactNode;
  /** Rendered after everything else in this phase — read-only rows are a plain stacked list, so
   *  unlike EditablePhaseGroup's grid-aligned appendTo*Grid there's only one sensible place for
   *  this to go regardless of where insertContent's own split lands. */
  trailingContent?: ReactNode;
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
      {trailingContent}
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

  // Full project detail — every phase at once, every department's history, admin-only actions
  // like reverting a completed step or correcting a date after the fact (see canEditDates/
  // canRevert below, which TaskCard renders unconditionally true on this page) — is an
  // admin/owner console, not a per-department work surface. Everyone else's actual work lives
  // in /my-tasks, whose own PATCH routes already carry their own per-department authorization
  // regardless of this page's own gate.
  if (!session || !isAdminEditor(session)) {
    redirect("/my-tasks");
  }

  // Opportunistic — may seed phase 3 ahead of 2F actually completing if every procurement item
  // arrived 2+ days ago (see maybeEarlyUnlockPhase3). Runs before the query below so a newly
  // unlocked phase 3 shows up in this same request, not just on the next page load.
  await maybeEarlyUnlockPhase3(id);

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true,
      // createdAt alone isn't a stable sort: steps within a phase are batch-inserted
      // via createMany and can share the same millisecond timestamp. stepCode as a
      // tiebreaker happens to sort correctly for every code in this schema (1A<1B<1C<1D,
      // 2A<2D1<2D2<2F, 3A<3B<3C1<3C2<3E — lexicographic order matches intended sequence).
      phaseSteps: {
        orderBy: [{ createdAt: "asc" }, { stepCode: "asc" }],
        include: { actionItems: { orderBy: { createdAt: "asc" } } },
      },
      procurementItems: { include: { actionItems: { orderBy: { createdAt: "asc" } } } },
      glassPurchaseOrder: { include: { actionItems: { orderBy: { createdAt: "asc" } } } },
      paymentSchedule: true,
    },
  });

  if (!project) notFound();

  const blockerHistory = await getBlockerHistory(id);
  const canEditEverything = !!session && isAdminEditor(session);

  const effectiveStatus = getEffectiveOverallStatus(
    project.overallStatus,
    projectHasOverrun(project.phaseSteps, project.procurementItems),
    project.procurementItems.some((i) => i.qcPassed === false) ||
      project.phaseSteps.some((s) => s.stepCode === "3E" && s.qcPassed === false)
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

  // Planned dates for every row are anchored to the same fixed point — 1D's actual end + 1
  // day, the day Phase 2 begins — rather than to each item's own (manually-entered) actual
  // dates. Anchoring to the actual dates would mean the plan couldn't show until the very
  // fields it's meant to be compared against were already filled in, and would shift every
  // time one of them changed.
  const oneD = project.phaseSteps.find((s) => s.stepCode === "1D");
  const phase2PlanAnchor = computePhase2PlanAnchor(
    oneD?.plannedEndDate ?? null,
    oneD?.actualEndDate ?? null,
    oneD?.delayCategory ?? null
  );

  // Each customer review card's "Planned end date" is just a read-only mirror of its matching
  // step's own — see PhaseReviewCard's own comment for why it doesn't store a planned date at
  // all. sm:col-span-2 on the wrapper only does anything where the card actually lands inside an
  // editable grid (appendToBeforeGrid/appendToAfterGrid below): 1A-1D and 3B/3C1/3C2/3E each fill
  // 3 columns with one card alone on its own last row on xl screens, so spanning 2 uses the rest
  // of that row instead of leaving it empty; at sm's 2 columns that same span just makes it the
  // full width of its own row. In the read-only (non-grid) view this class has nothing to act on
  // and is simply inert.
  const canEditReview = !!session && isAdminEditor(session);
  const twoA = project.phaseSteps.find((s) => s.stepCode === "2A");
  const phase1ReviewCard = (
    <div className="sm:col-span-2">
      <PhaseReviewCard
        title="Phase 1 customer review"
        projectId={project.id}
        plannedEndDate={twoA?.plannedEndDate?.toISOString() ?? null}
        plannedEndDateHint="2A's own planned date (Purchase requirement) — fixed, not editable here"
        actualEndDate={project.phase1ReviewActualEndDate?.toISOString() ?? null}
        note={project.phase1ReviewNote}
        canEdit={canEditReview}
        actualEndDateField="phase1ReviewActualEndDate"
        noteField="phase1ReviewNote"
      />
    </div>
  );
  const threeE = project.phaseSteps.find((s) => s.stepCode === "3E");
  const phase3ReviewCard = (
    <div className="sm:col-span-2">
      <PhaseReviewCard
        title="Phase 3 customer review"
        projectId={project.id}
        plannedEndDate={threeE?.plannedEndDate?.toISOString() ?? null}
        plannedEndDateHint="3E's own planned date (Final QC on site) — fixed, not editable here"
        actualEndDate={project.phase3ReviewActualEndDate?.toISOString() ?? null}
        note={project.phase3ReviewNote}
        canEdit={canEditReview}
        actualEndDateField="phase3ReviewActualEndDate"
        noteField="phase3ReviewNote"
      />
    </div>
  );

  // Same admin-or-owning-department authorization as the main phase-steps PATCH route — 3E's
  // action plan and follow-up rows are that department's own field, not an admin-only proxy
  // edit like the review card just above.
  const canEditSiteQC =
    !!session &&
    !!threeE &&
    (isAdminEditor(session) ||
      session.department === threeE.owningDepartment ||
      session.department === threeE.secondaryDepartment);
  const siteQCTracker =
    threeE && threeE.qcPassed === false ? (
      <div className="sm:col-span-2">
        <SiteQCTracker
          phaseStepId={threeE.id}
          actionPlanAt={threeE.actionPlanAt?.toISOString() ?? null}
          actionPlanPlannedDate={
            threeE.qcCheckedAt ? computeExpectedActionPlanDate(threeE.qcCheckedAt).toISOString() : null
          }
          actionPlanNote={threeE.actionPlanNote}
          canEdit={canEditSiteQC}
          canAddActionItem={threeE.qcPassed === false && !!threeE.actionPlanAt}
          actionItems={threeE.actionItems.map((a) => ({
            id: a.id,
            taskLabel: a.taskLabel,
            department: a.department,
            isPassFail: a.isPassFail,
            qcPassed: a.qcPassed,
            plannedDate: a.plannedDate.toISOString(),
            actualDate: a.actualDate?.toISOString() ?? null,
            note: a.note,
          }))}
        />
      </div>
    ) : null;
  const phase3TrailingContent = (
    <>
      {phase3ReviewCard}
      {siteQCTracker}
    </>
  );

  // No row exists until the first milestone is ever marked received (see the payment-schedule
  // PATCH route's upsert) — every field just reads as not-yet-received until then.
  const paymentSchedule = {
    tokenReceivedAt: project.paymentSchedule?.tokenReceivedAt?.toISOString() ?? null,
    milestone1ReceivedAt: project.paymentSchedule?.milestone1ReceivedAt?.toISOString() ?? null,
    milestone2ReceivedAt: project.paymentSchedule?.milestone2ReceivedAt?.toISOString() ?? null,
    milestone3ReceivedAt: project.paymentSchedule?.milestone3ReceivedAt?.toISOString() ?? null,
    milestone4ReceivedAt: project.paymentSchedule?.milestone4ReceivedAt?.toISOString() ?? null,
    milestone5ReceivedAt: project.paymentSchedule?.milestone5ReceivedAt?.toISOString() ?? null,
  };

  // Procurement items sit "under" 2A rather than being phase_steps themselves, so they don't
  // get their own upstreamDelay from getMyTasks — resolved here the same way, off the project's
  // own step graph. A restarted item (its own planAnchorOverride) plans off a client-given date
  // instead of the shared chain, so it no longer inherits whatever delayed that chain.
  const procurementUpstreamDelay = findUpstreamDelay(
    "2A",
    project.phaseSteps.map((s) => ({ stepCode: s.stepCode, dependsOn: s.dependsOn, delayCategory: s.delayCategory }))
  );

  // Hardware/gasket's own QC planned date is Section's — all three item types get QC-checked
  // together, in the same pass (see computeHardwareGasketChainDates) — so this is resolved once,
  // up front, rather than inside the per-item .map() below where hardware/gasket's own iteration
  // has no way to see Section's independently-computed chain from a different iteration.
  const sectionItem = project.procurementItems.find((i) => i.itemType === "section");
  const sectionQCPlanned = sectionItem ? computeSectionQCPlanned(sectionItem, phase2PlanAnchor) : null;

  const procurementTracker = (
    <ProcurementTracker
      canEdit={!!session && (isAdminEditor(session) || session.department === "purchase")}
      canEditRequirement={!!session && session.department === "design_engineer"}
      canEditPayment={!!session && session.department === "accounts"}
      items={[...project.procurementItems]
        .sort((a, b) => ITEM_TYPE_ORDER[a.itemType] - ITEM_TYPE_ORDER[b.itemType])
        .map((item) => {
          // A restarted item (after a QC failure) carries its own client-given planned date
          // instead of the project's default — see resetProcurementItem in procurement.ts.
          // Every other item keeps following the shared anchor as before.
          const itemPlanAnchor = item.planAnchorOverride ?? phase2PlanAnchor;
          const planned = computeProcurementPlannedDates(item.itemType, itemPlanAnchor, {
            requirement: item.requirementPlannedOverride,
            quote: item.quotePlannedOverride,
            payment: item.paymentPlannedOverride,
            order: item.orderPlannedOverride,
            arrival: item.arrivalPlannedOverride,
            qc: item.qcPlannedOverride,
          });

          // Section alone runs Material despatch/Arrived-for-powder-coating and, downstream of
          // them, its own chained Arrival/QC dates — see computeSectionChainDates. Hardware and
          // gasket chain Quote through QC off each other's own planned dates instead — see
          // computeHardwareGasketChainDates. Neither reads `planned.quote/payment/order/arrival/
          // qc` any more; only `planned.requirement` is shared by every item type.
          const isSection = item.itemType === "section";
          const isHardwareOrGasket = item.itemType === "hardware" || item.itemType === "gasket";
          const sectionChain = isSection
            ? computeSectionChainDates(
                planned.order,
                item.orderConfirmedAt,
                item.materialDespatchAt,
                item.arrivedForPowderCoatingAt,
                {
                  materialDespatch: item.materialDespatchPlannedOverride,
                  powderCoatingArrival: item.arrivedForPowderCoatingPlannedOverride,
                  arrival: item.arrivalPlannedOverride,
                  qc: item.qcPlannedOverride,
                }
              )
            : null;
          const hwGasketChain = isHardwareOrGasket
            ? computeHardwareGasketChainDates(planned.requirement, sectionQCPlanned, {
                quote: item.quotePlannedOverride,
                payment: item.paymentPlannedOverride,
                order: item.orderPlannedOverride,
                arrival: item.arrivalPlannedOverride,
                qc: item.qcPlannedOverride,
              })
            : null;

          const resolvedQuote = isHardwareOrGasket ? hwGasketChain!.quote : planned.quote;
          const resolvedPayment = isHardwareOrGasket ? hwGasketChain!.payment : planned.payment;
          const resolvedOrder = isHardwareOrGasket ? hwGasketChain!.order : planned.order;
          // Same function 2D1's own planned date uses (see computeItemArrivalPlanned) — kept in
          // sync by construction rather than re-deriving this item's arrival date a second way.
          const resolvedArrival = computeItemArrivalPlanned(item, phase2PlanAnchor);
          const resolvedQC = isSection ? sectionChain!.qc : isHardwareOrGasket ? hwGasketChain!.qc : planned.qc;

          const stages = [
            {
              id: "requirement",
              label: "Requirement created",
              dateField: "requirementCreatedAt" as const,
              noteField: "requirementNote" as const,
              actualDate: item.requirementCreatedAt,
              note: item.requirementNote,
              plannedDate: planned.requirement,
              plannedDateField: "requirementPlannedOverride" as const,
              department: "design_engineer" as const,
              secondaryDepartment: null,
              requirementGated: true,
              paymentGated: false,
              qcPassed: null,
            },
            {
              id: "quote",
              label: "Quote created",
              dateField: "quoteCreatedAt" as const,
              noteField: "quoteNote" as const,
              actualDate: item.quoteCreatedAt,
              note: item.quoteNote,
              plannedDate: resolvedQuote,
              plannedDateField: "quotePlannedOverride" as const,
              department: "purchase" as const,
              secondaryDepartment: null,
              requirementGated: false,
              paymentGated: false,
              qcPassed: null,
            },
            {
              id: "payment",
              label: "Payment done",
              dateField: "paymentSettledAt" as const,
              noteField: "paymentNote" as const,
              actualDate: item.paymentSettledAt,
              note: item.paymentNote,
              plannedDate: resolvedPayment,
              plannedDateField: "paymentPlannedOverride" as const,
              department: "accounts" as const,
              secondaryDepartment: "purchase" as const,
              requirementGated: false,
              paymentGated: true,
              qcPassed: null,
            },
            {
              id: "order",
              label: "Order confirmed",
              dateField: "orderConfirmedAt" as const,
              noteField: "orderNote" as const,
              actualDate: item.orderConfirmedAt,
              note: item.orderNote,
              plannedDate: resolvedOrder,
              plannedDateField: "orderPlannedOverride" as const,
              department: "purchase" as const,
              secondaryDepartment: null,
              requirementGated: false,
              paymentGated: false,
              qcPassed: null,
            },
            // Section only — plans off Order confirmed's own ground-truth date, not the shared
            // anchor. Editable like the other fixed stages: an edit here re-anchors every later
            // stage in the chain, same as the rest.
            ...(isSection
              ? [
                  {
                    id: "materialDespatch",
                    label: "Material despatch",
                    dateField: "materialDespatchAt" as const,
                    noteField: "materialDespatchNote" as const,
                    actualDate: item.materialDespatchAt,
                    note: item.materialDespatchNote,
                    plannedDate: sectionChain!.materialDespatch,
                    plannedDateField: "materialDespatchPlannedOverride" as const,
                    department: "purchase" as const,
                    secondaryDepartment: null,
                    requirementGated: false,
                    paymentGated: false,
                    qcPassed: null,
                  },
                  {
                    id: "arrivedForPowderCoating",
                    label: "Arrived for powder coating",
                    dateField: "arrivedForPowderCoatingAt" as const,
                    noteField: "arrivedForPowderCoatingNote" as const,
                    actualDate: item.arrivedForPowderCoatingAt,
                    note: item.arrivedForPowderCoatingNote,
                    plannedDate: sectionChain!.powderCoatingArrival,
                    plannedDateField: "arrivedForPowderCoatingPlannedOverride" as const,
                    department: "purchase" as const,
                    secondaryDepartment: null,
                    requirementGated: false,
                    paymentGated: false,
                    qcPassed: null,
                  },
                ]
              : []),
            {
              id: "arrival",
              label: "Actual arrival",
              dateField: "actualArrivalDate" as const,
              noteField: "arrivalNote" as const,
              actualDate: item.actualArrivalDate,
              note: item.arrivalNote,
              plannedDate: resolvedArrival,
              plannedDateField: "arrivalPlannedOverride" as const,
              department: "purchase" as const,
              secondaryDepartment: null,
              requirementGated: false,
              paymentGated: false,
              qcPassed: null,
            },
            {
              id: "qc",
              label: "QC checked",
              dateField: "qcCheckedAt" as const,
              noteField: "qcNote" as const,
              actualDate: item.qcCheckedAt,
              note: item.qcNote,
              plannedDate: resolvedQC,
              plannedDateField: "qcPlannedOverride" as const,
              department: "purchase" as const,
              secondaryDepartment: null,
              requirementGated: false,
              paymentGated: false,
              qcPassed: item.qcPassed,
            },
            // Only exists once this item has actually failed QC — nothing to plan an action
            // around before then. Plans off qc_checked_at itself, not the shared anchor, since
            // that's the one date this stage can't predate. Its own Planned date stays
            // system-computed — only the 6 fixed stages above get a manual override.
            ...(item.qcPassed === false
              ? [
                  {
                    id: "actionPlan",
                    label: "Action plan",
                    dateField: "actionPlanAt" as const,
                    noteField: "actionPlanNote" as const,
                    actualDate: item.actionPlanAt,
                    note: item.actionPlanNote,
                    plannedDate: item.qcCheckedAt ? computeExpectedActionPlanDate(item.qcCheckedAt) : null,
                    plannedDateField: null,
                    department: "purchase" as const,
                    secondaryDepartment: null,
                    requirementGated: false,
                    paymentGated: false,
                    qcPassed: null,
                  },
                ]
              : []),
          ].map((stage) => ({
            id: stage.id,
            label: stage.label,
            dateField: stage.dateField,
            noteField: stage.noteField,
            plannedDate: stage.plannedDate?.toISOString() ?? null,
            plannedDateField: stage.plannedDateField,
            actualDate: stage.actualDate?.toISOString() ?? null,
            note: stage.note,
            overrun: isProcurementStageOverrun(stage.plannedDate, stage.actualDate),
            department: stage.department,
            secondaryDepartment: stage.secondaryDepartment,
            requirementGated: stage.requirementGated,
            paymentGated: stage.paymentGated,
            qcPassed: stage.qcPassed,
          }));

          return {
            id: item.id,
            itemType: item.itemType,
            stages,
            planAnchorOverride: item.planAnchorOverride?.toISOString() ?? null,
            upstreamDelay: item.planAnchorOverride ? null : procurementUpstreamDelay,
            canAddActionItem: item.qcPassed === false && !!item.actionPlanAt,
            actionItems: item.actionItems.map((a) => ({
              id: a.id,
              taskLabel: a.taskLabel,
              department: a.department,
              isPassFail: a.isPassFail,
              qcPassed: a.qcPassed,
              plannedDate: a.plannedDate.toISOString(),
              actualDate: a.actualDate?.toISOString() ?? null,
              note: a.note,
              overrun: isProcurementStageOverrun(a.plannedDate, a.actualDate),
            })),
          };
        })}
    />
  );

  // Quote/Order are Purchase's own domain — same split as the procurement tracker: Requirement
  // created belongs to Design Engineer (2A's own gate), Payment done belongs to Accounts.
  const canEditGlass = !!session && (isAdminEditor(session) || session.department === "purchase");
  const canEditGlassRequirement = !!session && session.department === "design_engineer";
  const canEditGlassPayment = !!session && session.department === "accounts";
  const glassPO = project.glassPurchaseOrder;
  const glassStages: {
    id: string;
    label: string;
    dateField: string;
    noteField: string;
    actualDate: Date | null;
    note: string | null;
    plannedDate: Date | null;
    plannedDateField: string | null;
    department: GlassStageData["department"];
    secondaryDepartment?: GlassStageData["secondaryDepartment"];
    requirementGated: boolean;
    paymentGated: boolean;
    qcPassed: boolean | null;
  }[] = glassPO
    ? [
        {
          id: "requirement",
          label: "Requirement created",
          dateField: "requirementCreatedAt",
          noteField: "requirementNote",
          actualDate: glassPO.requirementCreatedAt,
          note: glassPO.requirementNote,
          plannedDate: glassPO.requirementPlannedDate,
          plannedDateField: "requirementPlannedDate",
          department: "design_engineer",
          requirementGated: true,
          paymentGated: false,
          qcPassed: null,
        },
        {
          id: "quote",
          label: "Quote created",
          dateField: "quoteCreatedAt",
          noteField: "quoteNote",
          actualDate: glassPO.quoteCreatedAt,
          note: glassPO.quoteNote,
          plannedDate: glassPO.quotePlannedDate,
          plannedDateField: "quotePlannedDate",
          department: "purchase",
          requirementGated: false,
          paymentGated: false,
          qcPassed: null,
        },
        {
          id: "payment",
          label: "Payment done",
          dateField: "paymentSettledAt",
          noteField: "paymentNote",
          actualDate: glassPO.paymentSettledAt,
          note: glassPO.paymentNote,
          plannedDate: glassPO.paymentPlannedDate,
          plannedDateField: "paymentPlannedDate",
          department: "accounts",
          secondaryDepartment: "purchase",
          requirementGated: false,
          paymentGated: true,
          qcPassed: null,
        },
        {
          id: "order",
          label: "Order confirmed",
          dateField: "orderConfirmedAt",
          noteField: "orderNote",
          actualDate: glassPO.orderConfirmedAt,
          note: glassPO.orderNote,
          plannedDate: glassPO.orderPlannedDate,
          plannedDateField: "orderPlannedDate",
          department: "purchase",
          requirementGated: false,
          paymentGated: false,
          qcPassed: null,
        },
        {
          id: "arrival",
          label: "Actual arrival",
          dateField: "actualArrivalDate",
          noteField: "arrivalNote",
          actualDate: glassPO.actualArrivalDate,
          note: glassPO.arrivalNote,
          plannedDate: glassPO.arrivalPlannedDate,
          plannedDateField: "arrivalPlannedDate",
          department: "purchase",
          requirementGated: false,
          paymentGated: false,
          qcPassed: null,
        },
        {
          id: "qc",
          label: "QC checked",
          dateField: "qcCheckedAt",
          noteField: "qcNote",
          actualDate: glassPO.qcCheckedAt,
          note: glassPO.qcNote,
          plannedDate: glassPO.qcPlannedDate,
          plannedDateField: "qcPlannedDate",
          department: "purchase",
          requirementGated: false,
          paymentGated: false,
          qcPassed: glassPO.qcPassed,
        },
        // Only exists once the glass PO has actually failed QC — nothing to plan an action
        // around before then. Plans off qc_checked_at itself, same formula as the procurement
        // tracker's own action plan row. Its own Planned date stays system-computed — only the
        // 6 fixed stages above get a manual Planned field.
        ...(glassPO.qcPassed === false
          ? [
              {
                id: "actionPlan",
                label: "Action plan",
                dateField: "actionPlanAt",
                noteField: "actionPlanNote",
                actualDate: glassPO.actionPlanAt,
                note: glassPO.actionPlanNote,
                plannedDate: glassPO.qcCheckedAt ? computeExpectedActionPlanDate(glassPO.qcCheckedAt) : null,
                plannedDateField: null,
                department: "purchase" as const,
                requirementGated: false,
                paymentGated: false,
                qcPassed: null,
              },
            ]
          : []),
      ]
    : [];
  const glassTracker = glassPO ? (
    <GlassTracker
      id={glassPO.id}
      canEdit={canEditGlass}
      canEditRequirement={canEditGlassRequirement}
      canEditPayment={canEditGlassPayment}
      canAddActionItem={glassPO.qcPassed === false && !!glassPO.actionPlanAt}
      stages={glassStages.map((stage) => ({
        ...stage,
        actualDate: stage.actualDate?.toISOString() ?? null,
        plannedDate: stage.plannedDate?.toISOString() ?? null,
      }))}
      actionItems={glassPO.actionItems.map((a) => ({
        id: a.id,
        taskLabel: a.taskLabel,
        department: a.department,
        isPassFail: a.isPassFail,
        qcPassed: a.qcPassed,
        plannedDate: a.plannedDate.toISOString(),
        actualDate: a.actualDate?.toISOString() ?? null,
        note: a.note,
      }))}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-xl border border-edge border-t-4 border-t-accent bg-gradient-to-br from-indigo-50 to-70% to-surface p-5 shadow-[var(--shadow-sm)] dark:from-indigo-500/10 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
                <path d="M4 6a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6Z" strokeLinejoin="round" />
              </svg>
            </span>
            <div>
              <h1 className="text-xl font-semibold text-fg">{project.name}</h1>
              <p className="text-sm text-fg-muted">
                {project.client.name} · {project.client.phone}
              </p>
              <p className="text-sm text-fg-muted">{project.client.address}</p>
            </div>
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
                className="flex h-8 items-center justify-center rounded-lg border border-edge px-3 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg"
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
            paymentSchedule={paymentSchedule}
          />
        </div>
      </div>

      <StepProgressBar steps={project.phaseSteps} />

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
                <circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
                <circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none" />
                <path d="M9.5 6h9M9.5 12h9M9.5 18h9" strokeLinecap="round" />
              </svg>
            </span>
            <h2 className="text-lg font-semibold text-fg">Step timeline</h2>
          </div>
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
                appendToBeforeGrid={phase === "phase_1" ? phase1ReviewCard : undefined}
              />
            ))
          : beforePhase3.map(({ phase, steps }) => (
              <ReadOnlyPhaseGroup
                key={phase}
                phase={phase}
                steps={steps}
                insertBeforeStepCode={phase === "phase_2" ? MATERIALS_ARRIVED_STEP_CODE : undefined}
                insertContent={phase === "phase_2" ? procurementTracker : undefined}
                trailingContent={phase === "phase_1" ? phase1ReviewCard : undefined}
              />
            ))}
      </div>

      {(canEditEverything ? editablePhase3Only.length > 0 : phase3Only.length > 0) && (
        <div className="flex flex-col gap-4">
          {canEditEverything
            ? editablePhase3Only.map(({ phase, items }) => (
                <EditablePhaseGroup
                  key={phase}
                  phase={phase}
                  items={items}
                  insertBeforeStepCode="3B"
                  insertContent={glassTracker}
                  appendToAfterGrid={phase3TrailingContent}
                />
              ))
            : phase3Only.map(({ phase, steps }) => (
                <ReadOnlyPhaseGroup
                  key={phase}
                  phase={phase}
                  steps={steps}
                  insertBeforeStepCode="3B"
                  insertContent={glassTracker}
                  trailingContent={phase3TrailingContent}
                />
              ))}
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M6.4 6.4 17.6 17.6" strokeLinecap="round" />
            </svg>
          </span>
          <h2 className="text-lg font-semibold text-fg">Blocker history</h2>
        </div>
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
                        ? "bg-overlay text-fg-muted ring-1 ring-inset ring-edge"
                        : "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200 dark:bg-red-500/10 dark:text-red-400 dark:ring-red-500/25"
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
