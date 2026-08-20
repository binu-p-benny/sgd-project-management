import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

const createSchema = z.object({
  taskLabel: z.string().trim().min(1, "A task name is required"),
  plannedDate: z.string().datetime(),
});

/**
 * Adds one custom follow-up task under an item's action plan — only reachable once that item
 * has actually failed QC and its action plan is marked (mirrors the "Add row" CTA's own
 * visibility in ProcurementTracker). Unlike every fixed stage above it, there's no cap on how
 * many of these an item can have; each is its own row, added one at a time.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorized = isAdminEditor(session) || session.department === "purchase";
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's field" }, { status: 403 });
  }

  const { id } = await params;
  const item = await prisma.procurementItem.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Procurement item not found" }, { status: 404 });
  }
  if (item.qcPassed !== false || !item.actionPlanAt) {
    return NextResponse.json(
      { error: "This item needs a failed QC check and a recorded action plan before rows can be added" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const actionItem = await prisma.procurementActionItem.create({
    data: {
      procurementItemId: id,
      taskLabel: parsed.data.taskLabel,
      plannedDate: new Date(parsed.data.plannedDate),
    },
  });

  return NextResponse.json(actionItem, { status: 201 });
}
