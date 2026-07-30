import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { StepStatus } from "@prisma/client";
import { getSession, isAdminEditor } from "@/lib/auth";
import { StepActionError, planStepRevert, revertStep } from "@/lib/step-actions";

const revertSchema = z.object({
  // Omit to take the default landing status: completed reopens as in_progress, a started or
  // blocked step resets to not_started.
  toStatus: z.nativeEnum(StepStatus).optional(),
  reason: z.string().min(1, "A reason is required to revert a step"),
  // Opt-in to clearing the procurement fields behind any derived step downstream. Without it a
  // revert blocked by one is refused (409) rather than discarding those entries unasked.
  clearDerivedProcurement: z.boolean().optional(),
});

/**
 * Reverting a step rewrites history — it clears actual dates, resets every downstream step,
 * and can move the project back a phase. That blast radius makes it an admin correction tool
 * (owner_admin or HR & Admin), same restriction as the direct date overrides in ../dates,
 * rather than something a step's owning department can trigger on its own.
 */
function authorize(session: Awaited<ReturnType<typeof getSession>>) {
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json(
      { error: "Forbidden — only owner_admin and HR & Admin can revert a step" },
      { status: 403 }
    );
  }
  return null;
}

function errorResponse(err: unknown) {
  if (err instanceof StepActionError) {
    return NextResponse.json({ error: err.message, detail: err.detail }, { status: err.status });
  }
  throw err;
}

/** Dry run: what a revert would touch, for the confirmation UI. Writes nothing. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const denied = authorize(session);
  if (denied) return denied;

  const { id } = await params;

  try {
    return NextResponse.json(await planStepRevert(id));
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  const denied = authorize(session);
  if (denied) return denied;

  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = revertSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await revertStep(id, session!.userId, parsed.data);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
