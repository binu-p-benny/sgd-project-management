import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { buildPhase1Steps, computePlannedDates } from "@/lib/step-template";
import type { OverallStatus, PaymentStatus, ProjectPhase } from "@prisma/client";

const createProjectSchema = z.object({
  name: z.string().min(1),
  clientName: z.string().min(1),
  clientPhone: z.string().min(1),
  clientAddress: z.string().min(1),
  finalCost: z.number().positive(),
  glassType: z.enum(["normal", "laminated"]),
});

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const now = new Date();

  const phase1Steps = buildPhase1Steps();
  const plannedDates = computePlannedDates(phase1Steps, now);

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        name: data.name,
        clientName: data.clientName,
        clientPhone: data.clientPhone,
        clientAddress: data.clientAddress,
        finalCost: data.finalCost,
        glassType: data.glassType,
        plannedStartDate: now,
        currentPhase: "phase_1",
        overallStatus: "on_track",
      },
    });

    await tx.phaseStep.createMany({
      data: phase1Steps.map((step) => {
        const dates = plannedDates.get(step.stepCode)!;
        return {
          projectId: created.id,
          phase: step.phase,
          stepCode: step.stepCode,
          stepName: step.stepName,
          owningDepartment: step.owningDepartment,
          secondaryDepartment: step.secondaryDepartment,
          plannedDurationDays: step.plannedDurationDays,
          dependsOn: step.dependsOn,
          plannedStartDate: dates.plannedStartDate,
          plannedEndDate: dates.plannedEndDate,
        };
      }),
    });

    return created;
  });

  return NextResponse.json(project, { status: 201 });
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const phase = searchParams.get("phase") as ProjectPhase | null;
  const status = searchParams.get("status") as OverallStatus | null;
  const paymentStatus = searchParams.get("paymentStatus") as PaymentStatus | null;
  const department = searchParams.get("department");

  const projects = await prisma.project.findMany({
    where: {
      ...(phase ? { currentPhase: phase } : {}),
      ...(status ? { overallStatus: status } : {}),
      ...(paymentStatus ? { paymentStatus } : {}),
      ...(department
        ? { phaseSteps: { some: { owningDepartment: department as never } } }
        : {}),
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(projects);
}
