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
      <div>
        <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Admin</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Every open step across every department — update on anyone&apos;s behalf.
          {department ? ` Showing ${DEPARTMENT_LABELS[department]}.` : ""} {items.length} open step
          {items.length === 1 ? "" : "s"}
        </p>
      </div>

      <AdminFilters />

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-300 py-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
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
