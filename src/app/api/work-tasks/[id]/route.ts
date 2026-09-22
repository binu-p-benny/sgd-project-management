import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateSchema = z.object({
  actualDate: dateOrNull,
  qcPassed: z.boolean().nullable().optional(),
  note: z.string().nullable().optional(),
});

/**
 * Records progress against one work row — actual date, note, and (only for a row created with
 * isPassFail) the pass/fail outcome; taskLabel, department and isPassFail are all fixed at
 * creation. Mirrors PATCH /api/service-items/[id]. Open to an admin editor or to the department
 * the row was assigned to, same "your department's own step" rule as PATCH /api/phase-steps/[id].
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
  const task = await prisma.workTask.findUnique({ where: { id } });
  if (!task) {
    return NextResponse.json({ error: "Work row not found" }, { status: 404 });
  }

  if (!isAdminEditor(session) && session.department !== task.department) {
    return NextResponse.json({ error: "Forbidden — not your department's row" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Clearing actualDate back to empty is a revert — qcPassed resets with it, same coupling as
  // ServiceItem's own actualDate/qcPassed handling.
  const { actualDate, qcPassed, ...rest } = parsed.data;
  const newQcPassed = actualDate === null ? null : qcPassed;
  const updated = await prisma.workTask.update({
    where: { id },
    data: { ...rest, actualDate, qcPassed: newQcPassed },
  });

  return NextResponse.json(updated);
}
