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
  note: z.string().nullable().optional(),
});

/**
 * Records progress against one custom action-plan row — actual date and note only; taskLabel
 * and plannedDate are fixed at creation, same as every fixed stage's own Planned column never
 * being editable after the fact. Whether a note is required (late completion or a correction to
 * an already-done row) is enforced client-side only, same as the fixed stages above it — there's
 * no server-side check here either, for the same reason.
 */
export async function PATCH(
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
  const actionItem = await prisma.procurementActionItem.findUnique({ where: { id } });
  if (!actionItem) {
    return NextResponse.json({ error: "Action item not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const updated = await prisma.procurementActionItem.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(updated);
}
