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
 * Adds one custom follow-up task under the glass PO's action plan — only reachable once it has
 * actually failed QC and its action plan is marked (mirrors the "Add row" CTA's own visibility in
 * GlassTracker). Mirrors /api/procurement-items/[id]/action-items exactly, just scoped to
 * GlassPurchaseOrder/GlassActionItem — including the freely-chosen department and the Pass/Fail
 * opt-in.
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
  const glassPO = await prisma.glassPurchaseOrder.findUnique({ where: { id } });
  if (!glassPO) {
    return NextResponse.json({ error: "Glass purchase order not found" }, { status: 404 });
  }
  if (glassPO.qcPassed !== false || !glassPO.actionPlanAt) {
    return NextResponse.json(
      { error: "This needs a failed QC check and a recorded action plan before rows can be added" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const actionItem = await prisma.glassActionItem.create({
    data: {
      glassPurchaseOrderId: id,
      taskLabel: parsed.data.taskLabel,
      department: parsed.data.department,
      isPassFail: parsed.data.isPassFail,
      plannedDate: new Date(parsed.data.plannedDate),
    },
  });

  return NextResponse.json(actionItem, { status: 201 });
}
