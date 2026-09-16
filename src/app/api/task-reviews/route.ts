import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, isOwnerAdmin, isOperationsManager } from "@/lib/auth";
import { markTaskReviewed } from "@/lib/task-reviews";

const reviewSchema = z.object({
  taskId: z.string().min(1),
  note: z.string().nullable().optional(),
});

/** Marks one completed unit of work (see task-reviews.ts) as reviewed — Operations Manager's own
 *  action, plus owner_admin as the usual full-access fallback. Not isAdminEditor: HR & Admin's
 *  own proxy-edit powers over other departments' work are a different concern from actually
 *  reviewing it. */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session || !(isOperationsManager(session) || isOwnerAdmin(session))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = reviewSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const note = parsed.data.note?.trim() || null;
  await markTaskReviewed(parsed.data.taskId, note);
  return NextResponse.json({ ok: true });
}
