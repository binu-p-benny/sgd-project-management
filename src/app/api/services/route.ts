import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";

const createServiceSchema = z.object({
  title: z.string().min(1),
  clientName: z.string().min(1),
  clientPhone: z.string().min(1),
  clientAddress: z.string().min(1),
  description: z.string().nullable().optional(),
  finalCost: z.number().positive(),
});

/**
 * Creates a standalone service — no phase steps, no procurement rows, nothing else seeded.
 * Work on it starts from an empty item table (see ServiceTracker.tsx / POST /api/services/[id]/items).
 */
export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const parsed = createServiceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const service = await prisma.service.create({
    data: {
      title: data.title,
      clientName: data.clientName,
      clientPhone: data.clientPhone,
      clientAddress: data.clientAddress,
      description: data.description || null,
      finalCost: data.finalCost,
    },
  });

  return NextResponse.json(service, { status: 201 });
}

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const services = await prisma.service.findMany({
    include: { items: { select: { plannedDate: true, actualDate: true, isPassFail: true, qcPassed: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(services);
}
