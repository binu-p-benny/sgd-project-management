import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { CLIENT_IN_USE_MESSAGE, isClientInUseError } from "@/lib/clients";

/**
 * Removes a client outright — unlike Project/Service, a client with nothing attached has no
 * history worth keeping, so this is a real delete rather than a soft one. The client_id relation
 * on Project/Service is left at its default RESTRICT, so nothing here ever needs to (and
 * shouldn't) cascade-delete a project or service just because its client was removed.
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
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can delete a client" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const client = await prisma.client.findUnique({
    where: { id },
    select: { id: true, _count: { select: { projects: true, services: true } } },
  });
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }
  if (client._count.projects > 0 || client._count.services > 0) {
    return NextResponse.json({ error: CLIENT_IN_USE_MESSAGE }, { status: 409 });
  }

  try {
    await prisma.client.delete({ where: { id } });
  } catch (error) {
    if (isClientInUseError(error)) {
      return NextResponse.json({ error: CLIENT_IN_USE_MESSAGE }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ id, deleted: true });
}
