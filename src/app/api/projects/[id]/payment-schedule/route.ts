import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

const dateOrNull = z.string().datetime().nullable().optional();

const updateSchema = z.object({
  tokenReceivedAt: dateOrNull,
  milestone1ReceivedAt: dateOrNull,
  milestone2ReceivedAt: dateOrNull,
  milestone3ReceivedAt: dateOrNull,
  milestone4ReceivedAt: dateOrNull,
  milestone5ReceivedAt: dateOrNull,
});

/**
 * Marks (or un-marks) one row of the Payment schedule modal as received — see PAYMENT_MILESTONES
 * in lib/payment-schedule.ts for what each field corresponds to; the row's own label/percentage
 * is a fixed template, not stored here, only the per-project received date is. Same domain as
 * PaymentEditor's own PATCH /api/projects/[id], so the same authorization applies. Upserts: a
 * project's schedule row doesn't exist until its first mark-received click, rather than being
 * seeded for every project up front.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const authorized = isAdminEditor(session) || session.department === "accounts";
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — payment info is Accounts' domain" }, { status: 403 });
  }

  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = Object.fromEntries(
    Object.entries(parsed.data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, v === null ? null : new Date(v as string)])
  );
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No fields provided" }, { status: 400 });
  }

  const schedule = await prisma.paymentSchedule.upsert({
    where: { projectId: id },
    update: data,
    create: { projectId: id, ...data },
  });

  return NextResponse.json(schedule);
}
