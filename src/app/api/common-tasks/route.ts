import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ASSIGNABLE_DEPARTMENTS, RECURRENCE_OPTIONS } from "@/lib/labels";

const createSchema = z.object({
  taskLabel: z.string().trim().min(1, "A task needs a name").max(200, "Keep it under 200 characters"),
  department: z.enum(ASSIGNABLE_DEPARTMENTS),
  recurrence: z.enum(RECURRENCE_OPTIONS).default("none"),
  plannedDate: z.string().datetime(),
  note: z.string().trim().max(1000).optional(),
});

/**
 * Raises a day-to-day/recurring admin chore with no project of its own — same admin-editor-only
 * gate as raising a project follow-up (see POST /api/projects/[id]/follow-ups), just with
 * nothing to anchor against since this isn't about any project. Completing one (and, for a
 * recurring task, advancing it to its next cycle) is PATCH /api/common-tasks/[id].
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json(
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can add a common task" },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { taskLabel, department, recurrence, plannedDate, note } = parsed.data;

  const task = await prisma.commonTask.create({
    data: {
      taskLabel,
      department,
      recurrence,
      plannedDate: new Date(plannedDate),
      note: note || null,
      createdByUserId: session.userId,
    },
  });

  return NextResponse.json(task, { status: 201 });
}
