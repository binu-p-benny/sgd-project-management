import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ASSIGNABLE_DEPARTMENTS } from "@/lib/labels";

const createSchema = z.object({
  taskLabel: z.string().trim().min(1, "A task name is required"),
  plannedDate: z.string().datetime(),
  department: z.enum(ASSIGNABLE_DEPARTMENTS),
  isPassFail: z.boolean().optional().default(false),
});

/**
 * Adds one work row to a work block — a block starts empty and grows one row at a time. Mirrors
 * POST /api/services/[id]/items exactly (task, department, optional Pass/Fail, planned date), see
 * AddItemRow in ServiceTracker.tsx, which the "+ Add row" form here shares.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json(
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can add a work row" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const block = await prisma.workBlock.findUnique({ where: { id }, select: { id: true } });
  if (!block) {
    return NextResponse.json({ error: "Work block not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const task = await prisma.workTask.create({
    data: {
      workBlockId: id,
      taskLabel: parsed.data.taskLabel,
      department: parsed.data.department,
      isPassFail: parsed.data.isPassFail,
      plannedDate: new Date(parsed.data.plannedDate),
    },
  });

  return NextResponse.json(task, { status: 201 });
}
