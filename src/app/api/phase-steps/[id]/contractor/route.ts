import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { MANUAL_CONTRACTOR_STEP_CODES } from "@/lib/step-actions";

const bodySchema = z.object({ contractorId: z.string().min(1, "Choose a contractor") });

/**
 * Sets a manual-contractor step's contractor — 3C1 only today (see MANUAL_CONTRACTOR_STEP_CODES).
 * Deliberately its own route rather than folded into /dates: that route is admin-only (owner_admin
 * or HR & Admin) for correcting actual/planned dates by hand, but choosing who's fabricating the
 * aluminum framework is squarely the owning department's own call, not an admin override — so this
 * is also reachable by whoever the step is actually assigned to (its owning/secondary department),
 * straight from /my-tasks, not just from the project page.
 */
export async function PATCH(
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
  if (!MANUAL_CONTRACTOR_STEP_CODES.has(step.stepCode)) {
    return NextResponse.json({ error: `${step.stepCode} has no contractor field to set` }, { status: 400 });
  }

  const canEdit =
    isAdminEditor(session) ||
    session.department === step.owningDepartment ||
    session.department === step.secondaryDepartment;
  if (!canEdit) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const contractor = await prisma.contractor.findUnique({
    where: { id: parsed.data.contractorId },
    select: { id: true, name: true },
  });
  if (!contractor) {
    return NextResponse.json({ error: "Contractor not found" }, { status: 400 });
  }

  const updated = await prisma.phaseStep.update({
    where: { id },
    data: { contractorId: contractor.id },
  });

  await prisma.stepStatusLog.create({
    data: {
      phaseStepId: id,
      changedByUserId: session.userId,
      oldStatus: step.status,
      newStatus: step.status,
      reason: `Contractor selected — ${contractor.name}`,
    },
  });

  return NextResponse.json(updated);
}
