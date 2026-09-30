import { prisma } from "@/lib/prisma";
import { phoneMatches, portalPasswordMatches } from "@/lib/client-auth";
import { PORTAL_PHASE_STEP_CODES } from "@/lib/portal-labels";
import {
  computeExpectedMaterialDespatchDate,
  computeExpectedPowderCoatingArrivalDate,
  computeExpectedSectionArrivalDate,
} from "@/lib/procurement";
import type { BlockedReason, StepPhase, StepStatus } from "@prisma/client";

const PORTAL_PHASES: StepPhase[] = ["phase_1", "phase_2", "phase_3"];

/**
 * A phase whose steps don't exist yet, shown as what is planned rather than left out. A project
 * only gets its Phase 3 rows when it reaches Phase 3, and a client seeing the timeline stop after
 * Materials has no way to know installation is still coming. These carry no dates and no status
 * beyond "not started", and they are added after the percentage is worked out, so they never
 * make a project look less far along than it is.
 */
function placeholderSteps(phase: StepPhase): PortalStep[] {
  return PORTAL_PHASE_STEP_CODES[phase].map((stepCode) => ({
    id: `planned:${phase}:${stepCode}`,
    stepCode,
    stepName: stepCode,
    phase,
    status: "not_started" as StepStatus,
    plannedStartDate: null,
    plannedEndDate: null,
    actualEndDate: null,
  }));
}

/**
 * Data behind the client portal. Everything here is read-only and scoped to the client ids on
 * the portal session — no route in the portal ever takes a project id from the request, so a
 * client cannot ask for someone else's project by changing a URL.
 */

export interface PortalClientMatch {
  id: string;
  name: string;
  phone: string;
}

/**
 * Clients whose phone matches what was typed AND whose derived password matches. Returns every
 * match rather than the first: phone numbers are not unique in this data (one number is on seven
 * different client rows), and the password's name prefix is what actually separates them. When
 * more than one survives both checks it is, in practice, the same person entered twice — so the
 * portal shows all their projects together.
 *
 * Filtering happens in memory because neither check is expressible in SQL here: phones are
 * stored in whatever shape they were typed (spaces, +91, dashes), and the password is derived
 * from the name and phone rather than stored.
 */
export async function findPortalClients(phone: string, password: string): Promise<PortalClientMatch[]> {
  const candidates = await prisma.client.findMany({ select: { id: true, name: true, phone: true } });
  return candidates.filter(
    (c) => phoneMatches(c.phone, phone) && portalPasswordMatches(c.name, c.phone, password)
  );
}

export interface PortalStep {
  id: string;
  stepCode: string;
  stepName: string;
  phase: StepPhase;
  status: StepStatus;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  actualEndDate: string | null;
  /**
   * What's happening while this step waits for the next one — shown on the connector leading
   * out of it (e.g. "In transit - material dispatched"). Only the material-chain steps in Phase
   * 2 ever set this; every other step is null.
   */
  gapCaption?: string | null;
  gapDelayed?: boolean;
  /** Set only when status is "blocked" — portalStepNote/Title name it to the client directly. */
  blockedReason?: BlockedReason | null;
  /** Marks a step's planned dates as rough estimates — see portalStepNote's "Approximate:" case. */
  datesAreEstimates?: boolean;
}

interface SectionItemDates {
  orderConfirmedAt: Date | null;
  materialDespatchAt: Date | null;
  arrivedForPowderCoatingAt: Date | null;
}

/**
 * Phase 2's material journey, replacing the internal "2A"/"2D1" steps with the section item's own
 * despatch chain (order confirmed -> dispatched -> arrived for powder coating -> arrived), the
 * physical journey a client actually cares about. Hardware/gasket have no despatch/powder-coating
 * stages of their own (see computeSectionChainDates in procurement.ts), so "Materials arrived"
 * still gates on all three items the same way the internal 2D1 step does — the client's timeline
 * just uses the section item's dates to explain the wait, since section is the one with the
 * multi-stage shipping in between.
 *
 * `reachedPhase2` is whether the project's procurement items exist at all (created the moment 1D
 * completes) — before that, the whole chain reads as planned-but-not-started, same as any other
 * phase a project hasn't reached yet.
 */
function buildMaterialChainSteps(
  section: SectionItemDates | undefined,
  materialsArrivedComplete: boolean,
  materialsArrivedDate: Date | null,
  reachedPhase2: boolean
): PortalStep[] {
  const orderConfirmedAt = section?.orderConfirmedAt ?? null;
  const materialDespatchAt = section?.materialDespatchAt ?? null;
  const arrivedForPowderCoatingAt = section?.arrivedForPowderCoatingAt ?? null;

  const materialDespatchPlanned = orderConfirmedAt ? computeExpectedMaterialDespatchDate(orderConfirmedAt) : null;
  const powderCoatingPlanned = materialDespatchAt ? computeExpectedPowderCoatingArrivalDate(materialDespatchAt) : null;
  const sectionArrivalPlanned = arrivedForPowderCoatingAt ? computeExpectedSectionArrivalDate(arrivedForPowderCoatingAt) : null;

  const now = Date.now();
  const isDue = (planned: Date | null) => planned !== null && planned.getTime() < now;

  const orderGap =
    orderConfirmedAt && !materialDespatchAt
      ? { caption: isDue(materialDespatchPlanned) ? "Production delayed" : "Production ongoing", delayed: isDue(materialDespatchPlanned) }
      : null;
  const dispatchGap =
    materialDespatchAt && !arrivedForPowderCoatingAt
      ? {
          caption: isDue(powderCoatingPlanned) ? "Dispatch delayed" : "In transit — material dispatched",
          delayed: isDue(powderCoatingPlanned),
        }
      : null;
  const powderCoatingGap =
    arrivedForPowderCoatingAt && !materialsArrivedComplete
      ? {
          caption: isDue(sectionArrivalPlanned) ? "Powder coating delayed" : "Arrived for powder coating — ongoing",
          delayed: isDue(sectionArrivalPlanned),
        }
      : null;

  return [
    {
      id: "material:order_confirmed",
      stepCode: "M-ORDER",
      stepName: "Order confirmed",
      phase: "phase_2",
      status: orderConfirmedAt ? "completed" : reachedPhase2 ? "in_progress" : "not_started",
      plannedStartDate: null,
      plannedEndDate: null,
      actualEndDate: orderConfirmedAt?.toISOString() ?? null,
      gapCaption: orderGap?.caption ?? null,
      gapDelayed: orderGap?.delayed ?? false,
    },
    {
      id: "material:dispatched",
      stepCode: "M-DISPATCH",
      stepName: "Material dispatched",
      phase: "phase_2",
      status: materialDespatchAt ? "completed" : orderConfirmedAt ? "in_progress" : "not_started",
      plannedStartDate: null,
      plannedEndDate: materialDespatchAt ? null : materialDespatchPlanned?.toISOString() ?? null,
      actualEndDate: materialDespatchAt?.toISOString() ?? null,
      gapCaption: dispatchGap?.caption ?? null,
      gapDelayed: dispatchGap?.delayed ?? false,
    },
    {
      id: "material:powder_coating",
      stepCode: "M-POWDER",
      stepName: "Arrived for powder coating",
      phase: "phase_2",
      status: arrivedForPowderCoatingAt ? "completed" : materialDespatchAt ? "in_progress" : "not_started",
      plannedStartDate: null,
      plannedEndDate: arrivedForPowderCoatingAt ? null : powderCoatingPlanned?.toISOString() ?? null,
      actualEndDate: arrivedForPowderCoatingAt?.toISOString() ?? null,
      gapCaption: powderCoatingGap?.caption ?? null,
      gapDelayed: powderCoatingGap?.delayed ?? false,
    },
    {
      id: "material:arrived",
      stepCode: "M-ARRIVED",
      stepName: "Materials arrived",
      phase: "phase_2",
      status: materialsArrivedComplete ? "completed" : arrivedForPowderCoatingAt ? "in_progress" : "not_started",
      plannedStartDate: null,
      plannedEndDate: materialsArrivedComplete ? null : sectionArrivalPlanned?.toISOString() ?? null,
      actualEndDate: materialsArrivedComplete ? materialsArrivedDate?.toISOString() ?? null : null,
      gapCaption: null,
      gapDelayed: false,
    },
  ];
}

interface RawSplitStep {
  id: string;
  status: StepStatus;
  plannedStartDate: Date | null;
  plannedEndDate: Date | null;
  actualStartDate: Date | null;
  actualEndDate: Date | null;
  blockedReason: BlockedReason | null;
}

/**
 * Splits one internal step (3C1 "Aluminium framework", 3C2 "Installation") into its own start and
 * end nodes on the client timeline — each is long enough on site that a client wants to know it
 * began, not just that it eventually finished. A step blocked before it's begun shows the block on
 * its start node; blocked mid-way shows it on the end node instead, since that's the one actually
 * stuck. `datesAreEstimates` marks Installation's own planned dates as rough ("Approximate:
 * <date>") rather than a firm promise — its planned window is a computed default that moves until
 * an admin locks it in (see computeInstallationPlannedWindow in reschedule.ts).
 */
function buildSplitStepPair(raw: RawSplitStep | undefined, codePrefix: string, datesAreEstimates: boolean): PortalStep[] {
  if (!raw) return [];
  const started = raw.actualStartDate !== null;
  const startStatus: StepStatus = started ? "completed" : raw.status === "blocked" ? "blocked" : "not_started";
  const endStatus: StepStatus = !started ? "not_started" : raw.status;

  return [
    {
      id: `${raw.id}:start`,
      stepCode: `${codePrefix}-START`,
      stepName: `${codePrefix}-START`,
      phase: "phase_3",
      status: startStatus,
      plannedStartDate: raw.plannedStartDate?.toISOString() ?? null,
      plannedEndDate: null,
      actualEndDate: raw.actualStartDate?.toISOString() ?? null,
      blockedReason: startStatus === "blocked" ? raw.blockedReason : null,
      datesAreEstimates,
    },
    {
      id: `${raw.id}:end`,
      stepCode: `${codePrefix}-END`,
      stepName: `${codePrefix}-END`,
      phase: "phase_3",
      status: endStatus,
      plannedStartDate: null,
      plannedEndDate: raw.plannedEndDate?.toISOString() ?? null,
      actualEndDate: raw.actualEndDate?.toISOString() ?? null,
      blockedReason: endStatus === "blocked" ? raw.blockedReason : null,
      datesAreEstimates,
    },
  ];
}

export interface PortalProject {
  id: string;
  name: string;
  clientName: string;
  currentPhase: string;
  startedOn: string | null;
  completedSteps: number;
  totalSteps: number;
  percentComplete: number;
  /** True once every step is done — the page says "Completed" rather than a percentage. */
  isComplete: boolean;
  steps: PortalStep[];
}

/**
 * Every project belonging to the given clients, newest first — the order the portal steps
 * through them ("one by one, based on the latest").
 *
 * Deliberately narrow: no blocked reason, no notes, no delay category, no department, no
 * procurement or payment rows. What comes back is what a client is shown, so nothing internal
 * can leak through a component that renders one field too many. Percentages are computed from
 * the project's own step count rather than a fixed total, since a project that was skipped
 * straight to Phase 3 genuinely has fewer steps.
 */
export async function getPortalProjects(clientIds: string[]): Promise<PortalProject[]> {
  if (clientIds.length === 0) return [];

  const projects = await prisma.project.findMany({
    where: { clientId: { in: clientIds } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      currentPhase: true,
      actualStartDate: true,
      createdAt: true,
      client: { select: { name: true } },
      phaseSteps: {
        orderBy: [{ createdAt: "asc" }, { stepCode: "asc" }],
        select: {
          id: true,
          stepCode: true,
          stepName: true,
          phase: true,
          status: true,
          plannedStartDate: true,
          plannedEndDate: true,
          actualStartDate: true,
          actualEndDate: true,
          blockedReason: true,
        },
      },
      procurementItems: {
        select: {
          itemType: true,
          orderConfirmedAt: true,
          materialDespatchAt: true,
          arrivedForPowderCoatingAt: true,
          actualArrivalDate: true,
        },
      },
    },
  });

  return projects.map((project) => {
    // Real steps only: the percentage and the "x of y steps" line describe work that exists,
    // not the phases still to be seeded.
    const totalSteps = project.phaseSteps.length;
    const completedSteps = project.phaseSteps.filter((s) => s.status === "completed").length;

    // 2A/2D1 are dropped here — the material chain built below replaces them. 3C1/3C2 are dropped
    // the same way — buildSplitStepPair replaces each with its own start/end pair below.
    const SUPERSEDED_CODES = new Set(["2A", "2D1", "3C1", "3C2"]);
    const steps: PortalStep[] = project.phaseSteps
      .filter((s) => !SUPERSEDED_CODES.has(s.stepCode))
      .map((s) => ({
        id: s.id,
        stepCode: s.stepCode,
        stepName: s.stepName,
        phase: s.phase,
        status: s.status,
        plannedStartDate: s.plannedStartDate?.toISOString() ?? null,
        plannedEndDate: s.plannedEndDate?.toISOString() ?? null,
        actualEndDate: s.actualEndDate?.toISOString() ?? null,
        blockedReason: s.status === "blocked" ? s.blockedReason : null,
      }));

    // Fill any wholly-missing phase (including Phase 2's own 2D2/2F) with not-started
    // placeholders BEFORE the material chain goes in below — otherwise every project would
    // already have a phase_2 entry (the material chain itself) and 2D2/2F would never get
    // seeded as placeholders for a project that hasn't reached them yet.
    for (const phase of PORTAL_PHASES) {
      if (!steps.some((s) => s.phase === phase)) steps.push(...placeholderSteps(phase));
    }

    const sectionItem = project.procurementItems.find((i) => i.itemType === "section");
    const materialsArrivedComplete =
      project.procurementItems.length === 3 && project.procurementItems.every((i) => i.actualArrivalDate !== null);
    const materialsArrivedDate = materialsArrivedComplete
      ? new Date(Math.max(...project.procurementItems.map((i) => i.actualArrivalDate!.getTime())))
      : null;
    const materialChainSteps = buildMaterialChainSteps(
      sectionItem,
      materialsArrivedComplete,
      materialsArrivedDate,
      project.procurementItems.length > 0
    );
    // Spliced in wherever Phase 2 currently starts (real 2D2/2F rows or their placeholders);
    // PhaseRun only cares about each step's own `phase` field, so where the rest of the array
    // sits doesn't matter.
    const phase2Index = steps.findIndex((s) => s.phase === "phase_2");
    steps.splice(phase2Index === -1 ? steps.length : phase2Index, 0, ...materialChainSteps);

    const rawC1 = project.phaseSteps.find((s) => s.stepCode === "3C1");
    const rawC2 = project.phaseSteps.find((s) => s.stepCode === "3C2");
    const splitSteps = [...buildSplitStepPair(rawC1, "3C1", false), ...buildSplitStepPair(rawC2, "3C2", true)];
    if (splitSteps.length > 0) {
      // 3E (real or placeholder) always exists by now — the placeholder fill above seeds every
      // phase_3 code, split ones included, the moment the whole phase is missing.
      const beforeFinalQC = steps.findIndex((s) => s.stepCode === "3E");
      steps.splice(beforeFinalQC === -1 ? steps.length : beforeFinalQC, 0, ...splitSteps);
    }

    return {
      id: project.id,
      name: project.name,
      clientName: project.client.name,
      currentPhase: project.currentPhase,
      startedOn: (project.actualStartDate ?? project.createdAt).toISOString(),
      completedSteps,
      totalSteps,
      percentComplete: totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100),
      isComplete: totalSteps > 0 && completedSteps === totalSteps,
      steps,
    };
  });
}
