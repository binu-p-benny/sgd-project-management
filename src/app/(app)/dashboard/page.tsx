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
  const [situationCounts, blocked, departmentWorkload, projectProgress, dueThisWeek, recentActivity] =
    await Promise.all([
      getProjectSituationCounts(),
      getBlockedStepsSorted(),
      getDepartmentWorkload(),
      getProjectProgressList(),
      getStepsDueThisWeek(),
      getRecentActivity(),
    ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Dashboard</h1>

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
