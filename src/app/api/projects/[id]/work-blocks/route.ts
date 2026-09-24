import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ASSIGNABLE_DEPARTMENTS } from "@/lib/labels";

const taskSchema = z.object({
  taskLabel: z.string().trim().min(1, "A task name is required"),
  plannedDate: z.string().datetime(),
  department: z.enum(ASSIGNABLE_DEPARTMENTS),
  isPassFail: z.boolean().optional().default(false),
});

const createSchema = z.object({
  label: z.string().trim().min(1, "A work block label is required").max(120, "Keep the label under 120 characters"),
  // Set only by the "Confirm block" modal (see BlockedWorkModal): ties the block to the blocked
  // step it exists to resolve, and lets its first rows be created in the same call.
  blockedPhaseStepId: z.string().min(1).optional(),
  tasks: z.array(taskSchema).optional(),
});

/**
 * Adds one "additional work" block to a project — just its label; the block's own rows are added
 * afterwards, one at a time (see /api/work-blocks/[id]/tasks). Same admin-editor gate as the
 * project detail page this lives on (see AdditionalWorks.tsx), which nobody else can open anyway.
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
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can add a work block" },
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

  const { label, blockedPhaseStepId, tasks } = parsed.data;
  if (blockedPhaseStepId) {
    const step = await prisma.phaseStep.findFirst({ where: { id: blockedPhaseStepId, projectId: id }, select: { id: true } });
    if (!step) {
      return NextResponse.json({ error: "Blocked step not found on this project" }, { status: 400 });
    }
  }

  const block = await prisma.workBlock.create({
    data: {
      projectId: id,
      label,
      blockedPhaseStepId: blockedPhaseStepId ?? null,
      ...(tasks && tasks.length > 0
        ? {
            tasks: {
              create: tasks.map((t) => ({
                taskLabel: t.taskLabel,
                department: t.department,
                isPassFail: t.isPassFail,
                plannedDate: new Date(t.plannedDate),
              })),
            },
          }
        : {}),
    },
  });

  return NextResponse.json(block, { status: 201 });
}
