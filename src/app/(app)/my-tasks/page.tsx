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
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
            <path d="M4 11.5 12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M6 10v9a1 1 0 0 0 1 1h3v-5.5h4V20h3a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h1 className="text-xl font-semibold text-fg">My Tasks</h1>
          <p className="text-sm text-fg-muted">
            {department ? DEPARTMENT_LABELS[department] : "All departments"} · {items.length} open step
            {items.length === 1 ? "" : "s"}
          </p>
        </div>
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
