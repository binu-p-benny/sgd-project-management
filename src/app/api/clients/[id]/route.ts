import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

/**
 * Removes a client outright — unlike Project/Service, a client with nothing attached has no
 * history worth keeping, so this is a real delete rather than a soft one. The client_id
 * relation on Project/Service is left at its default RESTRICT, so the database itself refuses
 * the delete (P2003) while any project or service still references this client; that's caught
 * below and turned into a clear 409 instead of a raw constraint error.
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
      { error: "Forbidden — only owner_admin and HR & Admin can delete a client" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const client = await prisma.client.findUnique({ where: { id }, select: { id: true } });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  try {
    await prisma.client.delete({ where: { id } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json(
        { error: "Can't delete — this client still has a project or service. Remove those first." },
        { status: 409 }
      );
    }
    throw error;
  }

  return NextResponse.json({ id, deleted: true });
}
