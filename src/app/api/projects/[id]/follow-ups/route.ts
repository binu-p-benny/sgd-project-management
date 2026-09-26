import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ASSIGNABLE_DEPARTMENTS } from "@/lib/labels";

const createSchema = z.object({
  taskLabel: z.string().trim().min(1, "A follow-up needs a name").max(200, "Keep it under 200 characters"),
  department: z.enum(ASSIGNABLE_DEPARTMENTS),
  plannedDate: z.string().datetime(),
  note: z.string().trim().max(1000).optional(),
  anchorKind: z.enum(["phase_step", "procurement_item", "glass_po"]),
  anchorId: z.string().min(1),
});

/**
 * Raises a follow-up against one card on the project detail page. The anchor is checked against
 * this project rather than trusted: a phase step, procurement item or Glass PO id from some
 * other project is refused, so a follow-up can never end up listed under a card its author
 * cannot see.
 *
 * Creation is admin-editor only, matching the rest of the editable project page (and
 * /api/projects/[id]/work-blocks, which this mirrors). Completing one is open to the department
 * it was assigned to — see PATCH /api/follow-ups/[id].
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json(
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can raise a follow-up" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { taskLabel, department, plannedDate, note, anchorKind, anchorId } = parsed.data;

  const anchorExists =
    anchorKind === "phase_step"
      ? await prisma.phaseStep.findFirst({ where: { id: anchorId, projectId: id }, select: { id: true } })
      : anchorKind === "procurement_item"
        ? await prisma.procurementItem.findFirst({ where: { id: anchorId, projectId: id }, select: { id: true } })
        : await prisma.glassPurchaseOrder.findFirst({ where: { id: anchorId, projectId: id }, select: { id: true } });
  if (!anchorExists) {
    return NextResponse.json({ error: "That card doesn't belong to this project" }, { status: 400 });
  }

  const followUp = await prisma.followUpTask.create({
    data: {
      projectId: id,
      taskLabel,
      department,
      plannedDate: new Date(plannedDate),
      note: note || null,
      createdByUserId: session.userId,
      ...(anchorKind === "phase_step" ? { phaseStepId: anchorId } : {}),
      ...(anchorKind === "procurement_item" ? { procurementItemId: anchorId } : {}),
      ...(anchorKind === "glass_po" ? { glassPurchaseOrderId: anchorId } : {}),
    },
  });

  return NextResponse.json(followUp, { status: 201 });
}
