import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";

const createSchema = z.object({
  label: z.string().trim().min(1, "A work block label is required").max(120, "Keep the label under 120 characters"),
});

/**
 * Adds one "additional work" block to a project — just its label; the block's own rows are added
 * afterwards, one at a time (see /api/work-blocks/[id]/tasks). Same admin-editor gate as the
 * project detail page this lives on (see AdditionalWorks.tsx), which nobody else can open anyway.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminEditor(session)) {
    return NextResponse.json(
      { error: "Forbidden — only owner_admin, HR & Admin and Operations Manager can add a work block" },
      { status: 403 }
    );
  }

  const { id } = await params;
  const project = await prisma.project.findUnique({ where: { id }, select: { id: true } });
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const block = await prisma.workBlock.create({ data: { projectId: id, label: parsed.data.label } });

  return NextResponse.json(block, { status: 201 });
}
