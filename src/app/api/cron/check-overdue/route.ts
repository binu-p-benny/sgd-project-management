import { NextRequest, NextResponse } from "next/server";
import { notifyOverdueSteps } from "@/lib/notify-overdue";

/**
 * Scheduled entry point for overdue-step notifications — no session cookie (crons don't
 * carry one), authenticated instead via a bearer secret. Vercel Cron sends this header
 * automatically when CRON_SECRET is set on the project; any other scheduler (cron-job.org,
 * a GitHub Actions workflow, etc.) can hit this same URL with the same header.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 500 });
  }

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await notifyOverdueSteps();
  return NextResponse.json(result);
}
