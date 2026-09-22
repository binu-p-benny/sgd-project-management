import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

/**
 * Removes a work block from the app without removing it from the database — deleted_at is
 * stamped and every read path filters on it (see lib/prisma.ts), taking the block's rows with it.
 * Same soft-delete convention as Project and Service.
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
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can delete a work block" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const block = await prisma.workBlock.findUnique({ where: { id }, select: { id: true } });
  if (!block) {
    return NextResponse.json({ error: "Work block not found" }, { status: 404 });
  }

  await prisma.workBlock.update({ where: { id }, data: { deletedAt: new Date() } });

  return NextResponse.json({ id, deleted: true });
}
