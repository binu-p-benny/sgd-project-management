import { redirect } from "next/navigation";
import { getSession, hasOwnerAccess } from "@/lib/auth";
import { getUnifiedMyTasks } from "@/lib/unified-tasks";
import { DepartmentTaskOverview } from "@/components/my-tasks/DepartmentTaskOverview";
import { AdminFilters } from "@/components/admin/AdminFilters";
import type { Department } from "@prisma/client";

/**
 * A whole-company, read-only view of every department's still-open work (see
 * DepartmentTaskOverview) — moved here from Operations Manager's own /my-tasks so it's a
 * dedicated page both Owner/Admin and Operations Manager can reach, rather than living inline
 * underneath OM's review queue. Owner-level only (see hasOwnerAccess): the same "manages every
 * department" audience /dashboard already restricts itself to.
 */
export default async function OpenWorkPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const session = await getSession();
  if (!session || !hasOwnerAccess(session)) {
    redirect("/my-tasks");
  }

  const params = await searchParams;
  const department = (params.department as Department | undefined) ?? null;
  const tasks = await getUnifiedMyTasks(department);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
            <path d="M4 11.5 12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 10v9a1 1 0 0 0 1 1h3v-5.5h4V20h3a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h1 className="text-xl font-semibold text-fg">Open Work</h1>
      </div>

      <AdminFilters basePath="/open-work" />

      <DepartmentTaskOverview tasks={tasks} />
    </div>
  );
}
