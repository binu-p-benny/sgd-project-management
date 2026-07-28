import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { Department } from "@prisma/client";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("project_id") ?? undefined;

  // Non-owner roles are always scoped to their own department, regardless of the query param.
  const department: Department | undefined =
    session.department === "owner_admin"
      ? (searchParams.get("department") as Department | null) ?? undefined
      : session.department;

  const steps = await prisma.phaseStep.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(department
        ? { OR: [{ owningDepartment: department }, { secondaryDepartment: department }] }
        : {}),
    },
    include: { project: { select: { id: true, name: true, clientName: true } } },
    orderBy: [{ projectId: "asc" }, { createdAt: "asc" }, { stepCode: "asc" }],
  });

  return NextResponse.json(steps);
}
