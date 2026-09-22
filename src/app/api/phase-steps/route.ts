import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hasOwnerAccess } from "@/lib/auth";
import type { Department } from "@prisma/client";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = request.nextUrl;
  const projectId = searchParams.get("project_id") ?? undefined;

  // Anyone without owner-level access is always scoped to their own department, regardless of the
  // query param. Operations Manager owns no steps of its own, so scoping it that way would just
  // come back empty — it sees every department's, same as the owner.
  const department: Department | undefined = hasOwnerAccess(session)
    ? (searchParams.get("department") as Department | null) ?? undefined
    : session.department;

  const steps = await prisma.phaseStep.findMany({
    where: {
      ...(projectId ? { projectId } : {}),
      ...(department
        ? { OR: [{ owningDepartment: department }, { secondaryDepartment: department }] }
        : {}),
    },
    include: { project: { select: { id: true, name: true, client: { select: { name: true } } } } },
    orderBy: [{ projectId: "asc" }, { createdAt: "asc" }, { stepCode: "asc" }],
  });

  return NextResponse.json(steps);
}
