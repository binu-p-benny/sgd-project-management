import {
  getProjectSituationCounts,
  getBlockedStepsSorted,
  getDepartmentWorkload,
  getProjectProgressList,
  getStepsDueThisWeek,
  getRecentActivity,
} from "@/lib/dashboard";
import { ProjectStatTiles } from "@/components/dashboard/ProjectStatTiles";
import { BlockedStepsWidget } from "@/components/dashboard/BlockedStepsWidget";
import { DepartmentWorkloadWidget } from "@/components/dashboard/DepartmentWorkloadWidget";
import { ProjectProgressWidget } from "@/components/dashboard/ProjectProgressWidget";
import { UpcomingStepsWidget } from "@/components/dashboard/UpcomingStepsWidget";
import { RecentActivityWidget } from "@/components/dashboard/RecentActivityWidget";

export default async function DashboardPage() {
  let situationCounts, blocked, departmentWorkload, projectProgress, dueThisWeek, recentActivity;
  try {
    [situationCounts, blocked, departmentWorkload, projectProgress, dueThisWeek, recentActivity] =
      await Promise.all([
        getProjectSituationCounts(),
        getBlockedStepsSorted(),
        getDepartmentWorkload(),
        getProjectProgressList(),
        getStepsDueThisWeek(),
        getRecentActivity(),
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
        <DepartmentWorkloadWidget data={departmentWorkload} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ProjectProgressWidget initialData={projectProgress} />
        <UpcomingStepsWidget data={dueThisWeek} />
      </div>

      <RecentActivityWidget initialData={recentActivity.rows} initialCursor={recentActivity.nextCursor} />
    </div>
  );
}
