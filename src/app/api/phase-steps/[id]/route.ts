import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { BlockedReason, StepStatus, VisitUrgency } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { StepActionError, updateStepStatus } from "@/lib/step-actions";

const updateSchema = z.object({
  status: z.nativeEnum(StepStatus).optional(),
  blockedReason: z.nativeEnum(BlockedReason).optional(),
  blockedNote: z.string().optional(),
  notes: z.string().optional(),
  visitUrgency: z.nativeEnum(VisitUrgency).optional(),
});

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

  const authorized =
    isAdminEditor(session) ||
    session.department === step.owningDepartment ||
    session.department === step.secondaryDepartment;
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's step" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { status, ...options } = parsed.data;
  if (!status) {
    return NextResponse.json({ error: "status is required" }, { status: 400 });
  }

  try {
    const updated = await updateStepStatus(id, status, session.userId, options);
    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof StepActionError) {
      return NextResponse.json({ error: err.message, detail: err.detail }, { status: err.status });
    }
    throw err;
  }
}
