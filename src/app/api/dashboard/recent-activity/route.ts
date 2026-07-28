import { NextRequest, NextResponse } from "next/server";
import { getSession, isOwnerAdmin } from "@/lib/auth";
import { getRecentActivity } from "@/lib/dashboard";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isOwnerAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const cursor = req.nextUrl.searchParams.get("cursor") ?? undefined;
  const page = await getRecentActivity({ cursor });
  return NextResponse.json(page);
}
