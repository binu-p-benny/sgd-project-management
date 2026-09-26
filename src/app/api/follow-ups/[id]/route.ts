import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ASSIGNABLE_DEPARTMENTS } from "@/lib/labels";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  taskLabel: z.string().trim().min(1).max(200).optional(),
  department: z.enum(ASSIGNABLE_DEPARTMENTS).optional(),
  plannedDate: z.string().datetime().optional(),
  actualDate: dateOrNull,
  note: z.string().nullable().optional(),
});

/**
 * Records progress on a follow-up, or corrects it. Open to an admin editor or to the department
 * the follow-up was assigned to — the same "your department's own row" rule as PATCH
 * /api/work-tasks/[id], which is what lets a department close one from /my-tasks.
 *
 * Unlike a work row, the label, planned date and department stay editable: a follow-up is a note
 * to chase something, and who should chase it is exactly the kind of thing that changes.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const followUp = await prisma.followUpTask.findUnique({ where: { id } });
  if (!followUp) {
    return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
  }

  const admin = isAdminEditor(session);
  if (!admin && session.department !== followUp.department) {
    return NextResponse.json({ error: "Forbidden — not your department's follow-up" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { taskLabel, department, plannedDate, actualDate, note } = parsed.data;

  // Reassigning it, renaming it or moving its planned date is an admin-editor call — the
  // department it landed on can record what happened, not redefine the job or hand it on.
  if (!admin && (taskLabel !== undefined || department !== undefined || plannedDate !== undefined)) {
    return NextResponse.json(
      { error: "Forbidden — only an admin editor can rename, reschedule or reassign a follow-up" },
      { status: 403 }
    );
  }

  const updated = await prisma.followUpTask.update({
    where: { id },
    data: {
      ...(taskLabel !== undefined ? { taskLabel } : {}),
      ...(department !== undefined ? { department } : {}),
      ...(plannedDate !== undefined ? { plannedDate: new Date(plannedDate) } : {}),
      ...(actualDate !== undefined ? { actualDate } : {}),
      ...(note !== undefined ? { note } : {}),
    },
  });

  return NextResponse.json(updated);
}

/** Removes a follow-up outright — admin editors only. Nothing else references it. */
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json({ error: "Forbidden — only an admin editor can delete a follow-up" }, { status: 403 });
  }

  const { id } = await params;
  const followUp = await prisma.followUpTask.findUnique({ where: { id }, select: { id: true } });
  if (!followUp) {
    return NextResponse.json({ error: "Follow-up not found" }, { status: 404 });
  }

  await prisma.followUpTask.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
