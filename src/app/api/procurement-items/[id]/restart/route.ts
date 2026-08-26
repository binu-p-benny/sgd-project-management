import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { syncDerivedStepStatus } from "@/lib/step-actions";
import { resetProcurementItem } from "@/lib/procurement";
import { rescheduleProjectDates } from "@/lib/reschedule";

const restartSchema = z.object({
  planAnchor: z.string().datetime(),
});

/**
 * Restarts one procurement_item from "Requirement created" — only reachable once that item
 * has failed QC (see resetProcurementItem for what gets cleared). A confirmation step lives
 * entirely in the client; this endpoint just re-checks the precondition server-side so it
 * can't be triggered on an item that hasn't actually failed. `planAnchor` is the client's new
 * planned date for this item's redo, required every time — there's no default to fall back to,
 * since the whole point is that it no longer follows the project's original schedule.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const item = await prisma.procurementItem.findUnique({ where: { id } });
  if (!item) {
    return NextResponse.json({ error: "Procurement item not found" }, { status: 404 });
  }

  const authorized = isAdminEditor(session) || session.department === "purchase";
  if (!authorized) {
    return NextResponse.json({ error: "Forbidden — not your department's field" }, { status: 403 });
  }

  if (item.qcPassed !== false) {
    return NextResponse.json({ error: "Only an item that has failed QC can be restarted" }, { status: 400 });
  }

  const body = await request.json().catch(() => null);
  const parsed = restartSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "A new planned date is required to restart this item" }, { status: 400 });
  }

  await resetProcurementItem(id, new Date(parsed.data.planAnchor));

  await syncDerivedStepStatus(item.projectId, "2A", session.userId);
  await syncDerivedStepStatus(item.projectId, "2D1", session.userId);
  await syncDerivedStepStatus(item.projectId, "2F", session.userId);
  // The new plan anchor moves this item's own Actual arrival forecast independently of the
  // project's shared schedule — 2D1's planned date needs to pick that up even when it doesn't
  // change 2A/2D1/2F's status (see the same call in procurement-items/[id]/route.ts).
  await rescheduleProjectDates(item.projectId);

  const updated = await prisma.procurementItem.findUnique({ where: { id } });
  return NextResponse.json(updated);
}
