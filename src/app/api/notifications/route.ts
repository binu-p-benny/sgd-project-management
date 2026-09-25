import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

// The bell's dropdown is small — five rows fill it without scrolling, and older ones are
// reachable through the Previous/Next footer instead of an endless scroll list.
const PAGE_SIZE = 5;

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const pageParam = Number(request.nextUrl.searchParams.get("page"));
  const requestedPage = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;

  const where = { userId: session.userId };
  const [totalCount, unreadCount] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { ...where, readAt: null } }),
  ]);

  // Clamped server-side, same as getProjectProgressList: a client sitting on page 4 when the
  // history shrinks (or polling with a stale page number) gets the last real page, not an
  // empty list.
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const page = Math.min(requestedPage, totalPages);

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  return NextResponse.json({ notifications, unreadCount, page, pageSize: PAGE_SIZE, totalCount, totalPages });
}
