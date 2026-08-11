import { getMyTasks } from "@/lib/my-tasks";
import { TaskCard } from "@/components/my-tasks/TaskCard";
import { AdminFilters } from "@/components/admin/AdminFilters";
import { DEPARTMENT_LABELS } from "@/lib/labels";
import type { Department } from "@prisma/client";

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ department?: string }>;
}) {
  const params = await searchParams;
  const department = (params.department as Department | undefined) ?? null;
  const items = await getMyTasks(department);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
            <path d="M12 3.5 18.5 6v5.5c0 4.5-2.8 7.7-6.5 9-3.7-1.3-6.5-4.5-6.5-9V6L12 3.5Z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9.3 12.2l1.9 1.9 3.5-3.9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h1 className="text-xl font-semibold text-fg">Admin</h1>
          <p className="text-sm text-fg-muted">
            Every open step across every department — update on anyone&apos;s behalf.
            {department ? ` Showing ${DEPARTMENT_LABELS[department]}.` : ""} {items.length} open step
            {items.length === 1 ? "" : "s"}
          </p>
        </div>
      </div>

      <AdminFilters />

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge-2 py-10 text-center text-sm text-fg-muted">
          Nothing open right now.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <TaskCard key={item.id} item={item} showDepartment />
          ))}
        </div>
      )}
    </div>
  );
}
