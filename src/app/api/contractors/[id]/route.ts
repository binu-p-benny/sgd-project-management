import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

/**
 * Removes a contractor outright — same "no history worth keeping on its own" reasoning as
 * DELETE /api/clients/[id]. Nothing references a contractor yet (no project link exists), so
 * unlike that route this never has a RESTRICT violation to guard against — once a project does
 * link to one, add the same in-use check (see isClientInUseError in lib/clients.ts) before this
 * turns into an unhandled 500 the same way the client route's did.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json(
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can delete a contractor" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const contractor = await prisma.contractor.findUnique({ where: { id }, select: { id: true } });
  if (!contractor) {
    return NextResponse.json({ error: "Contractor not found" }, { status: 404 });
  }

  await prisma.contractor.delete({ where: { id } });

  return NextResponse.json({ id, deleted: true });
}
