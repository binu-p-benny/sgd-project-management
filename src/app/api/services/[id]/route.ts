import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
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
    include: { client: true, items: { orderBy: { createdAt: "asc" } } },
  });

  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  return NextResponse.json(service);
}

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateServiceSchema = z.object({
  title: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  // The only way completedAt is ever set or cleared — see the completion dropdown in the
  // services list and getServiceStatus's "never inferred from items" rule.
  completed: z.boolean().optional(),
  // The customer review follow-up — see ServiceReviewCard and getServiceStatus's
  // review_not_completed rule.
  reviewCompletedAt: dateOrNull,
  reviewNote: z.string().nullable().optional(),
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
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can edit service details" },
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

  if (parsed.data.clientId) {
    const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true } });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 400 });
    }
  }

  const { completed, ...rest } = parsed.data;
  const data: Prisma.ServiceUpdateInput = { ...rest };
  if (completed !== undefined) {
    data.completedAt = completed ? new Date() : null;
    // Reopening clears any review recorded for the completion being undone — a later
    // re-completion should get its own fresh review window, not inherit a stale one.
    if (!completed) {
      data.reviewCompletedAt = null;
      data.reviewNote = null;
    }
  }

  const service = await prisma.service.update({ where: { id }, data });
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
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can delete a service" },
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
