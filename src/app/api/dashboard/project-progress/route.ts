import { NextRequest, NextResponse } from "next/server";
import { getSession, isOwnerAdmin } from "@/lib/auth";
import { getProjectProgressList } from "@/lib/dashboard";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || !isOwnerAdmin(session)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const pageParam = req.nextUrl.searchParams.get("page");
  const page = pageParam ? Number(pageParam) : 1;
  const data = await getProjectProgressList({ page: Number.isFinite(page) && page > 0 ? page : 1 });
  return NextResponse.json(data);
}
