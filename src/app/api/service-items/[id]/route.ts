import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

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
 * Records progress against one service work-item row — actual date, note, and (only for a row
 * created with isPassFail) the pass/fail outcome; taskLabel, department and isPassFail are all
 * fixed at creation. Mirrors PATCH /api/procurement-action-items/[id] except there's no parent
 * QC-gate to resolve back into — a service item's own outcome is all there is.
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
  const item = await prisma.serviceItem.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Clearing actualDate back to empty is a revert — qcPassed resets with it, same coupling as
  // ProcurementActionItem's own actualDate/qcPassed handling.
  const { actualDate, qcPassed, ...rest } = parsed.data;
  const newQcPassed = actualDate === null ? null : qcPassed;
  const updated = await prisma.serviceItem.update({
    where: { id },
    data: { ...rest, actualDate, qcPassed: newQcPassed },
  });

  return NextResponse.json(updated);
}
