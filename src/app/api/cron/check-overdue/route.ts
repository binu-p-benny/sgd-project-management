import { NextRequest, NextResponse } from "next/server";
import { notifyOverdueSteps } from "@/lib/notify-overdue";
import {
  notifyContractorNotAssigned,
  notifyOverdueProcurement,
  notifyWebsiteReviewDue,
} from "@/lib/notify-cron";

/**
 * Scheduled entry point for every notification a daily sweep produces — overdue steps, overdue
 * procurement/Glass PO stages, unassigned contractors and the pending website review. No session
 * cookie (crons don't carry one), authenticated instead via a bearer secret. Vercel Cron sends
 * this header automatically when CRON_SECRET is set on the project; any other scheduler
 * (cron-job.org, a GitHub Actions workflow, etc.) can hit this same URL with the same header.
 *
 * Each sweep is independently idempotent, so a retry (or a manual run alongside the scheduled
 * one) re-sends nothing. They run in sequence rather than in parallel: this is a once-a-day job
 * against the same handful of tables, and one slow query beats three fighting over the pool.
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

  const steps = await notifyOverdueSteps();
  const procurement = await notifyOverdueProcurement();
  const contractors = await notifyContractorNotAssigned();
  const websiteReviews = await notifyWebsiteReviewDue();

  return NextResponse.json({
    // Kept at the top level as it always has been, so an existing monitor reading `notified`
    // doesn't start reporting nothing.
    notified: steps.notified,
    overdueSteps: steps.notified,
    overdueProcurement: procurement.notified,
    contractorNotAssigned: contractors.notified,
    websiteReviewsDue: websiteReviews.notified,
  });
}
