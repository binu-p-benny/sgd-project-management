import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, hasOwnerAccess } from "@/lib/auth";
import { StepActionError, skipToPhase } from "@/lib/step-actions";

const skipPhaseSchema = z.object({
  targetPhase: z.enum(["phase_2", "phase_3"]),
  asOfDate: z.string().datetime(),
});

/**
 * Backfills an already-live project straight to Phase 2 or Phase 3 — see skipToPhase in
 * step-actions.ts for what that actually mutates. Owner-level only (owner_admin and Operations
 * Manager — see hasOwnerAccess), not the wider isAdminEditor set (HR & Admin): this bulk-rewrites
 * history rather than recording today's work, a call for whoever runs the whole operation.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!hasOwnerAccess(session)) {
    return NextResponse.json(
      { error: "Forbidden — only the owner or Operations Manager can skip a phase" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = skipPhaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    await skipToPhase(id, parsed.data.targetPhase, new Date(parsed.data.asOfDate), session.userId);
  } catch (err) {
    if (err instanceof StepActionError) {
      return NextResponse.json({ error: err.message, detail: err.detail }, { status: err.status });
    }
    throw err;
  }

  return NextResponse.json({ id, skippedTo: parsed.data.targetPhase });
}
