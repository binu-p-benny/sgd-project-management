import {
  getProjectSituationCounts,
  getBlockedStepsSorted,
  getPhaseStatusSummary,
  getProjectProgressList,
  getStepsDueThisWeek,
  getRecentActivity,
  getServiceOverview,
} from "@/lib/dashboard";
import { ProjectStatTiles } from "@/components/dashboard/ProjectStatTiles";
import { BlockedStepsWidget } from "@/components/dashboard/BlockedStepsWidget";
import { PhaseStatusWidget } from "@/components/dashboard/PhaseStatusWidget";
import { ProjectProgressWidget } from "@/components/dashboard/ProjectProgressWidget";
import { UpcomingStepsWidget } from "@/components/dashboard/UpcomingStepsWidget";
import { RecentActivityWidget } from "@/components/dashboard/RecentActivityWidget";
import { ServiceStatusWidget } from "@/components/dashboard/ServiceStatusWidget";

export default async function DashboardPage() {
  let situationCounts, blocked, phaseStatus, projectProgress, dueThisWeek, recentActivity, serviceOverview;
  try {
    [situationCounts, blocked, phaseStatus, projectProgress, dueThisWeek, recentActivity, serviceOverview] =
      await Promise.all([
        getProjectSituationCounts(),
        getBlockedStepsSorted(),
        getPhaseStatusSummary(),
        getProjectProgressList(),
        getStepsDueThisWeek(),
        getRecentActivity(),
        getServiceOverview(),
      ]);
  } catch (error) {
    console.error("[dashboard] failed to load dashboard data", error);
    throw new Error("Unable to load dashboard data. Please try again shortly.");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
            <rect x="4" y="4" width="7" height="9" rx="1" />
            <rect x="13" y="4" width="7" height="5" rx="1" />
            <rect x="13" y="11" width="7" height="9" rx="1" />
            <rect x="4" y="15" width="7" height="5" rx="1" />
          </svg>
        </span>
        <h1 className="text-xl font-semibold text-fg">Dashboard</h1>
      </div>

      <ProjectStatTiles counts={situationCounts} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BlockedStepsWidget data={blocked} />
        <PhaseStatusWidget data={phaseStatus} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ProjectProgressWidget initialData={projectProgress} />
        <UpcomingStepsWidget data={dueThisWeek} />
      </div>

      <ServiceStatusWidget data={serviceOverview} />

      <RecentActivityWidget initialData={recentActivity.rows} initialCursor={recentActivity.nextCursor} />
    </div>
  );
}
