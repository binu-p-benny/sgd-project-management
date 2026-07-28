import { getSession } from "@/lib/auth";
import { getMyTasks } from "@/lib/my-tasks";
import { TaskCard } from "@/components/my-tasks/TaskCard";
import { DEPARTMENT_LABELS } from "@/lib/labels";

export default async function MyTasksPage() {
  const session = await getSession();
  const department = session && session.department !== "owner_admin" ? session.department : null;
  const items = await getMyTasks(department);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-fg">My Tasks</h1>
        <p className="text-sm text-fg-muted">
          {department ? DEPARTMENT_LABELS[department] : "All departments"} · {items.length} open step
          {items.length === 1 ? "" : "s"}
        </p>
      </div>

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-edge-2 py-10 text-center text-sm text-fg-muted">
          Nothing open right now.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <TaskCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
