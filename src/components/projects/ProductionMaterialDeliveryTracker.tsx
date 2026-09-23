"use client";

import { useRouter } from "next/navigation";
import { ItemRow, type ServiceItemData } from "@/components/services/ServiceTracker";

const DELIVERY_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
    <path d="M3 7h11v10H3z" strokeLinejoin="round" />
    <path d="M14 10h4l3 3v4h-7z" strokeLinejoin="round" />
    <circle cx="7" cy="18.5" r="1.5" />
    <circle cx="17" cy="18.5" r="1.5" />
  </svg>
);

/** One department's rows within the tracker — its own small heading plus a table matching
 *  WorkBlockCard's (AdditionalWorks.tsx) exactly, since these rows are the same WorkTask shape. */
function DepartmentGroup({
  title,
  tasks,
  canEdit,
  onSaved,
}: {
  title: string;
  tasks: ServiceItemData[];
  canEdit: boolean;
  onSaved: () => void;
}) {
  if (tasks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wider text-fg-subtle">{title}</h4>
      <div className="overflow-x-auto rounded-lg border border-edge">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-overlay text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Task</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Planned</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Actual</th>
              <th className="px-3 py-2 font-semibold">Reason / note</th>
              <th className="whitespace-nowrap px-3 py-2 font-semibold">Action</th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((task) => (
              <ItemRow
                key={task.id}
                item={task}
                editable={canEdit}
                patchUrl={`/api/work-tasks/${task.id}`}
                onSaved={onSaved}
                allowEditingTaskAndPlannedDate
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * "Production material Delivery" — the raw material each fabricated item (Section/Hardware/
 * Gasket) needs delivered before production can start, plus the two Design Engineer drawings
 * production needs — see ensureProductionMaterialDeliveryBlock in step-actions.ts, which seeds
 * this project's fixed 5 rows the first time Phase 3 is real. A plain, manually-ticked checklist
 * (same WorkTask rows Additional works uses — see AdditionalWorks.tsx), deliberately outside the
 * existing procurement chain, grouped here by department the way the task itself is worded rather
 * than AdditionalWorks' own flat list, and pinned under the Phase 3 · Installation heading instead
 * of the page's general Additional works section since every one of its rows is specifically
 * about material for this phase.
 */
export function ProductionMaterialDeliveryTracker({ tasks, canEdit }: { tasks: ServiceItemData[]; canEdit: boolean }) {
  const router = useRouter();
  if (tasks.length === 0) return null;

  const purchaseTasks = tasks.filter((t) => t.department === "purchase");
  const designTasks = tasks.filter((t) => t.department === "design_engineer");
  const onSaved = () => router.refresh();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
          {DELIVERY_ICON}
        </span>
        <h2 className="text-lg font-semibold text-fg">Production material Delivery</h2>
      </div>
      <div className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-4">
        <DepartmentGroup title="Purchase" tasks={purchaseTasks} canEdit={canEdit} onSaved={onSaved} />
        <DepartmentGroup title="Design Engineer" tasks={designTasks} canEdit={canEdit} onSaved={onSaved} />
      </div>
    </div>
  );
}
