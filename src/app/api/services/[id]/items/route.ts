import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ASSIGNABLE_DEPARTMENTS } from "@/lib/labels";

const createSchema = z.object({
  taskLabel: z.string().trim().min(1, "A task name is required"),
  plannedDate: z.string().datetime(),
  department: z.enum(ASSIGNABLE_DEPARTMENTS),
  isPassFail: z.boolean().optional().default(false),
});

/**
 * Adds one work-item row to a service — unlike ProcurementActionItem there's no precondition
 * (a service starts empty and work begins with the first row), so any signed-in user can add
 * one. Mirrors the "+ Add row" form in ProcurementTracker.tsx exactly (task, department,
 * optional Pass/Fail, planned date) — see ServiceTracker.tsx.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { id: true } });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const item = await prisma.serviceItem.create({
    data: {
      serviceId: id,
      taskLabel: parsed.data.taskLabel,
      department: parsed.data.department,
      isPassFail: parsed.data.isPassFail,
      plannedDate: new Date(parsed.data.plannedDate),
    },
  });

  return NextResponse.json(item, { status: 201 });
}
