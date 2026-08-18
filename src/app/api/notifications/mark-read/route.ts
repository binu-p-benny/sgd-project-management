import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const bodySchema = z.object({ id: z.string().optional() });

/** Marks one notification read (by id) or every unread one for the current user (no id). */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { id } = parsed.data;
  const now = new Date();

  // Scoped by userId in both branches — a user can only ever mark their own notifications,
  // never someone else's by guessing an id.
  const result = await prisma.notification.updateMany({
    where: { userId: session.userId, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: now },
  });

  return NextResponse.json({ updated: result.count });
}
