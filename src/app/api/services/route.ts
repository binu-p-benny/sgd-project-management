import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { addDays } from "@/lib/step-template";
import { ASSIGNABLE_DEPARTMENTS } from "@/lib/labels";

const createServiceSchema = z.object({
  title: z.string().min(1),
  clientId: z.string().min(1),
  description: z.string().nullable().optional(),
  // Which department the seeded "Action plan" row starts assigned to — optional so a caller
  // that doesn't send one still gets the column's own default (purchase), same as before this
  // existed.
  actionPlanDepartment: z.enum(ASSIGNABLE_DEPARTMENTS).optional(),
});

/**
 * Creates a standalone service — no phase steps, no procurement rows. Seeded with one work item,
 * "Action plan", planned for a day after creation — a service otherwise starts completely open-
 * ended (see ServiceTracker.tsx / POST /api/services/[id]/items for every row after this one).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;

  const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true } });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 400 });
  }

  const service = await prisma.$transaction(async (tx) => {
    const created = await tx.service.create({
      data: {
        title: data.title,
        clientId: data.clientId,
        description: data.description || null,
      },
    });

    await tx.serviceItem.create({
      data: {
        serviceId: created.id,
        taskLabel: "Action plan",
        plannedDate: addDays(created.createdAt, 1),
        ...(data.actionPlanDepartment ? { department: data.actionPlanDepartment } : {}),
      },
    });

    return created;
  });

  return NextResponse.json(service, { status: 201 });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = await prisma.service.findMany({
    include: {
      client: true,
      items: { select: { plannedDate: true, actualDate: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(services);
}
