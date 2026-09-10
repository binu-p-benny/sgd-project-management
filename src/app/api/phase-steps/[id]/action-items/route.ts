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
 * Adds one custom follow-up task under 3E's action plan — only reachable once 3E has actually
 * failed QC and its action plan is marked (mirrors the "Add row" CTA's own visibility in
 * SiteQCTracker, and the identical rule on ProcurementItem/GlassPurchaseOrder). Unlike a fixed
 * stage, there's no cap on how many of these a step can have; each is its own row, added one at
 * a time. Department is chosen by whoever adds the row (any of ASSIGNABLE_DEPARTMENTS) — a
 * QC-failure follow-up doesn't have to land back on 3E's own owning department. isPassFail opts
 * the row into a Pass/Fail button pair instead of a single Mark complete — some follow-ups
 * (e.g. a re-inspection) are themselves a pass/fail check.
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
  const step = await prisma.phaseStep.findUnique({ where: { id } });
  if (!step) {
    return NextResponse.json({ error: "Step not found" }, { status: 404 });
  }

  const authorized =
    isAdminEditor(session) ||
    session.department === step.owningDepartment ||
    session.department === step.secondaryDepartment;
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's step" }, { status: 403 });
  }

  if (step.qcPassed !== false || !step.actionPlanAt) {
    return NextResponse.json(
      { error: "This step needs a failed QC check and a recorded action plan before rows can be added" },
      { status: 400 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const actionItem = await prisma.phaseStepActionItem.create({
    data: {
      phaseStepId: id,
      taskLabel: parsed.data.taskLabel,
      department: parsed.data.department,
      isPassFail: parsed.data.isPassFail,
      plannedDate: new Date(parsed.data.plannedDate),
    },
  });

  return NextResponse.json(actionItem, { status: 201 });
}
