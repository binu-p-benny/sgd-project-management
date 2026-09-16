import { NextResponse } from "next/server";
import { getSession, canViewDashboard } from "@/lib/auth";
import { getPhaseStatusSummary } from "@/lib/dashboard";

export async function GET() {
  const session = await getSession();
  if (!session || !canViewDashboard(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.json(await getPhaseStatusSummary());
}
