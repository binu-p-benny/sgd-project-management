"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { AddItemRow, ItemRow, type ServiceItemData } from "@/components/services/ServiceTracker";

/** A work row has exactly a service item's shape (see WorkTask in schema.prisma), so it renders
 *  through the very same row component — this is just the name the rest of this file uses. */
export type WorkTaskData = ServiceItemData;

export interface WorkBlockData {
  id: string;
  label: string;
  /** Created from a step's "Confirm block" modal — see WorkBlock.blockedPhaseStepId. */
  blockedWork?: boolean;
  tasks: WorkTaskData[];
}

const BLOCKS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
    <rect x="4" y="4" width="7" height="7" rx="1.5" />
    <rect x="13" y="4" width="7" height="7" rx="1.5" />
    <rect x="4" y="13" width="7" height="7" rx="1.5" />
    <path d="M16.5 13.5v6M13.5 16.5h6" strokeLinecap="round" />
  </svg>
);

/** Two-step on purpose, same as DeleteServiceButton: the first click swaps in an explicit confirm,
 *  so a block (and every row in it) can't disappear from one stray click. */
function DeleteBlockButton({ blockId, label }: { blockId: string; label: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/work-blocks/${blockId}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Delete failed");
        setDeleting(false);
        return;
      }
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <span className="text-xs text-red-600 dark:text-red-400" title={error}>
        {error}
      </span>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        aria-label={`Delete work block ${label}`}
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-600 dark:hover:text-red-400"
      >
        Delete
      </button>
    );
  }

  return (
    <span className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={deleting}
        className="rounded-lg border border-edge px-2.5 py-1 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={remove}
        disabled={deleting}
        className="rounded-lg bg-red-500/15 px-2.5 py-1 text-xs font-medium text-red-600 ring-1 ring-inset ring-red-500/30 transition-colors hover:bg-red-500/25 disabled:opacity-40 dark:text-red-400"
      >
        {deleting ? <Spinner className="h-3.5 w-3.5" /> : "Confirm"}
      </button>
    </span>
  );
}

/** One work block — its label as the card heading, then the same task table a service's work
 *  items use, with "+ Add row" at the bottom. */
function WorkBlockCard({ block, canEdit }: { block: WorkBlockData; canEdit: boolean }) {
  const router = useRouter();
  const doneCount = block.tasks.filter((t) => t.actualDate !== null).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-overlay text-fg-muted">
            {BLOCKS_ICON}
          </span>
          <h3 className="truncate font-medium text-fg" title={block.label}>
            {block.label}
          </h3>
          {block.blockedWork && (
            <span className="shrink-0 rounded-full bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-700 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
              Blocked work tasks
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {block.tasks.length > 0 && (
            <span className="text-xs font-medium text-fg-subtle">
              {doneCount} / {block.tasks.length} done
            </span>
          )}
          {canEdit && <DeleteBlockButton blockId={block.id} label={block.label} />}
        </div>
      </div>

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
            {block.tasks.length === 0 && !canEdit && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-sm text-fg-subtle">
                  No work rows yet.
                </td>
              </tr>
            )}
            {block.tasks.map((task) => (
              <ItemRow
                key={task.id}
                item={task}
                editable={canEdit}
                patchUrl={`/api/work-tasks/${task.id}`}
                onSaved={() => router.refresh()}
                allowEditingTaskAndPlannedDate
              />
            ))}
            {canEdit && <AddItemRow addUrl={`/api/work-blocks/${block.id}/tasks`} onSaved={() => router.refresh()} />}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The "+ Add work block" CTA and the label form it opens into. Sits after the last block (or on
 *  its own when there are none yet), so the next block always starts from the bottom of the list. */
function AddWorkBlock({ projectId, hasBlocks }: { projectId: string; hasBlocks: boolean }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAdd() {
    setAdding(true);
    setLabelDraft("");
    setError(null);
  }

  async function handleAdd() {
    if (!labelDraft.trim()) {
      setError("Enter a label for this work block");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/work-blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelDraft.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const message = data.error?.fieldErrors?.label?.[0] ?? (typeof data.error === "string" ? data.error : null);
        setError(message ?? "Could not add this work block");
        setSubmitting(false);
        return;
      }
      setAdding(false);
      setSubmitting(false);
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  if (!adding) {
    return (
      <button
        type="button"
        onClick={openAdd}
        className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-edge-2 px-4 py-3 text-sm font-medium text-accent transition-colors hover:bg-overlay"
      >
        + {hasBlocks ? "Add another work block" : "Add work block"}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-edge bg-surface p-4">
      <label htmlFor="work-block-label" className="text-xs font-medium text-fg-muted">
        Work block label
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="work-block-label"
          type="text"
          autoFocus
          maxLength={120}
          placeholder="e.g. Extra balcony railing"
          value={labelDraft}
          disabled={submitting}
          onChange={(e) => setLabelDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAdd();
            if (e.key === "Escape") setAdding(false);
          }}
          className="h-10 w-full rounded-lg border border-edge bg-bg px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
        />
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setAdding(false)}
            disabled={submitting}
            className="flex h-10 items-center justify-center rounded-lg border border-edge px-4 text-xs font-medium text-fg-muted transition-colors hover:bg-overlay disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={submitting}
            className="flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Add"}
          </button>
        </div>
      </div>
      {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
    </div>
  );
}

/**
 * The "Additional works" section of the project detail page — extra work on top of the project's
 * standard flow, grouped into labelled blocks. Nothing here feeds the project's own steps,
 * status or schedule (see WorkBlock in schema.prisma); it's a place to plan and tick off extra
 * jobs one row at a time, the same way a service's work items are.
 */
export function AdditionalWorks({
  projectId,
  blocks,
  canEdit,
}: {
  projectId: string;
  blocks: WorkBlockData[];
  canEdit: boolean;
}) {
  if (blocks.length === 0 && !canEdit) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent ring-1 ring-inset ring-accent/20">
            {BLOCKS_ICON}
          </span>
          <h2 className="text-lg font-semibold text-fg">Additional works</h2>
        </div>
        {blocks.length > 0 && (
          <span className="text-xs font-medium text-fg-subtle">
            {blocks.length} work block{blocks.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {blocks.length === 0 && (
        <p className="rounded-lg border border-dashed border-edge-2 py-8 text-center text-sm text-fg-muted">
          No additional work on this project yet.
        </p>
      )}

      {blocks.map((block) => (
        <WorkBlockCard key={block.id} block={block} canEdit={canEdit} />
      ))}

      {canEdit && <AddWorkBlock projectId={projectId} hasBlocks={blocks.length > 0} />}
    </div>
  );
}
