import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { PaymentStatus } from "@prisma/client";
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
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      client: true,
      phaseSteps: { orderBy: [{ createdAt: "asc" }, { stepCode: "asc" }] },
      procurementItems: true,
    },
  });

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  return NextResponse.json(project);
}

const dateOrNull = z
  .string()
  .datetime()
  .nullable()
  .optional()
  .transform((v) => (v === undefined ? undefined : v === null ? null : new Date(v)));

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  clientId: z.string().min(1).optional(),
  roughDesignCompletedAt: dateOrNull,
  paymentStatus: z.nativeEnum(PaymentStatus).optional(),
  amountReceived: z.number().min(0).optional(),
  notes: z.string().nullable().optional(),
  // The Phase 1/3 customer review cards (Step timeline, HR & Admin only) — see the comment on
  // the Project model. Fall under "general info" below, same admin-only gate as the rest of that
  // group; nothing here ever touches phase_steps or procurement_items.
  phase1ReviewActualEndDate: dateOrNull,
  phase1ReviewNote: z.string().nullable().optional(),
  phase3ReviewActualEndDate: dateOrNull,
  phase3ReviewNote: z.string().nullable().optional(),
});

// "notes" counts as a payment-adjacent field for permission purposes — Accounts should
// be able to leave a note while adjusting payment, same as HR/owner can from the edit form.
const PAYMENT_FIELDS = new Set(["paymentStatus", "amountReceived", "notes"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const fields = Object.keys(parsed.data);
  const touchesGeneralInfo = fields.some((f) => !PAYMENT_FIELDS.has(f));
  const touchesPayment = fields.some((f) => PAYMENT_FIELDS.has(f));

  // General project/client info is an admin-only proxy edit. Payment fields are also
  // open to Accounts directly, since that's their own domain.
  if (touchesGeneralInfo && !isAdminEditor(session)) {
    return NextResponse.json({ error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can edit project details" }, { status: 403 });
  }
  if (touchesPayment && !isAdminEditor(session) && session.department !== "accounts") {
    return NextResponse.json({ error: "Forbidden — payment info is Accounts' domain" }, { status: 403 });
  }

  if (parsed.data.clientId) {
    const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true } });
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 400 });
    }
  }

  const project = await prisma.project.update({
    where: { id },
    data: parsed.data,
  });

  return NextResponse.json(project);
}

/**
 * Removes a project from the app without removing it from the database — deleted_at is stamped
 * and every read path filters on it (see lib/prisma.ts), so the project and all its history stay
 * intact but stop being visible anywhere in the front end.
 *
 * Admin-only. The read below goes through the filtered client, so calling this twice returns 404
 * the second time rather than silently re-stamping an already-deleted project.
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
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can delete a project" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  await prisma.project.update({ where: { id }, data: { deletedAt: new Date() } });

  return NextResponse.json({ id, deleted: true });
}
