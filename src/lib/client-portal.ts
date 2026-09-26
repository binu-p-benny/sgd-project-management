import { prisma } from "@/lib/prisma";
import { phoneMatches, portalPasswordMatches } from "@/lib/client-auth";
import type { StepPhase, StepStatus } from "@prisma/client";

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
          actualEndDate: true,
        },
      },
    },
  });

  return projects.map((project) => {
    const totalSteps = project.phaseSteps.length;
    const completedSteps = project.phaseSteps.filter((s) => s.status === "completed").length;
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
      steps: project.phaseSteps.map((s) => ({
        id: s.id,
        stepCode: s.stepCode,
        stepName: s.stepName,
        phase: s.phase,
        status: s.status,
        plannedStartDate: s.plannedStartDate?.toISOString() ?? null,
        plannedEndDate: s.plannedEndDate?.toISOString() ?? null,
        actualEndDate: s.actualEndDate?.toISOString() ?? null,
      })),
    };
  });
}
