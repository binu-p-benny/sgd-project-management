import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const service = await prisma.service.findUnique({
    where: { id },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });

  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  return NextResponse.json(service);
}

const updateServiceSchema = z.object({
  title: z.string().min(1).optional(),
  clientName: z.string().min(1).optional(),
  clientPhone: z.string().min(1).optional(),
  clientAddress: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  finalCost: z.number().positive().optional(),
});

/** General service/client info is an admin-only proxy edit, same as Project's own edit form. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json(
      { error: "Forbidden — only owner_admin and HR & Admin can edit service details" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.service.findUnique({ where: { id }, select: { id: true } });
  if (!existing) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  const service = await prisma.service.update({ where: { id }, data: parsed.data });
  return NextResponse.json(service);
}

/**
 * Removes a service from the app without removing it from the database — deleted_at is stamped
 * and every read path filters on it (see lib/prisma.ts), same soft-delete convention as Project.
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
      { error: "Forbidden — only owner_admin and HR & Admin can delete a service" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const service = await prisma.service.findUnique({ where: { id }, select: { id: true } });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  await prisma.service.update({ where: { id }, data: { deletedAt: new Date() } });

  return NextResponse.json({ id, deleted: true });
}
