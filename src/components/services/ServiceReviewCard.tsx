"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";
import { Spinner } from "@/components/ui/Spinner";

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso)
  );
}

// Some browsers only open the native calendar when the small icon is clicked, not the rest of
// the field — showPicker() makes the whole input open it on any click.
function openPicker(e: React.MouseEvent<HTMLInputElement>) {
  const input = e.currentTarget;
  if (typeof input.showPicker === "function") {
    try {
      input.showPicker();
    } catch {
      // no-op: unsupported in this browser, or not triggered by a direct user gesture
    }
  }
}

/**
 * The post-completion "how did it go" follow-up — mirrors PhaseReviewCard's shape (planned date
 * read-only, actual date + freeform note editable), styled the same way for the same reason: it
 * reads as its own kind of thing, not one more work item. No gate, blocks nothing on its own —
 * but see getServiceStatus in lib/service.ts, which flips the service's status to
 * review_not_completed once the planned date passes with this still unfilled. Unlike
 * PhaseReviewCard there's no step to mirror the planned date from — it's computed straight off
 * completedAt (see getServiceReviewPlannedDate), so this card only ever renders once a service
 * actually has one.
 */
export function ServiceReviewCard({
  serviceId,
  plannedDate,
  reviewCompletedAt,
  reviewNote,
  canEdit,
}: {
  serviceId: string;
  plannedDate: string;
  reviewCompletedAt: string | null;
  reviewNote: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [actualDraft, setActualDraft] = useSyncedDraft(reviewCompletedAt, toDateInputValue);
  const [noteDraft, setNoteDraft] = useSyncedDraft(reviewNote, (v) => v ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/services/${serviceId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewCompletedAt: actualDraft ? new Date(actualDraft).toISOString() : null,
          reviewNote: noteDraft.trim() || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Could not save the review");
        setSubmitting(false);
        return;
      }
      setSaved(true);
      router.refresh();
      setSubmitting(false);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-fuchsia-500/50 bg-fuchsia-500/5 p-4 dark:border-fuchsia-500/35 dark:bg-fuchsia-500/[0.05]">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-fuchsia-50 text-fuchsia-700 ring-1 ring-inset ring-fuchsia-200 dark:bg-fuchsia-500/10 dark:text-fuchsia-400 dark:ring-fuchsia-500/25">
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
            <path d="M5 5h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H10l-4 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" strokeLinejoin="round" />
            <path d="M8 10h8M8 14h5" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <h3 className="font-medium text-fg">Customer review</h3>
          <p className="text-xs text-fg-muted">Client feedback after completion — doesn&apos;t reopen the work itself</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:w-1/2">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Planned date</label>
          <input
            type="date"
            value={toDateInputValue(plannedDate)}
            disabled
            readOnly
            title="2 days after the service was marked completed"
            className="h-10 w-full rounded-lg border border-edge bg-overlay px-2 text-sm text-fg-muted outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Actual date</label>
          {canEdit ? (
            <input
              type="date"
              value={actualDraft}
              disabled={submitting}
              onChange={(e) => setActualDraft(e.target.value)}
              onClick={openPicker}
              className="h-10 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
            />
          ) : (
            <span className="flex h-10 items-center text-sm text-fg-muted">{formatDate(reviewCompletedAt)}</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">Client review</label>
        {canEdit ? (
          <textarea
            rows={3}
            placeholder="What did the client say?"
            value={noteDraft}
            disabled={submitting}
            onChange={(e) => setNoteDraft(e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
        ) : (
          <p className="text-sm italic text-fg-muted">{reviewNote ? `"${reviewNote}"` : "—"}</p>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={submitting}
            className="flex h-9 items-center justify-center rounded-lg bg-fuchsia-600 px-4 text-xs font-medium text-white transition-colors hover:bg-fuchsia-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Save"}
          </button>
          {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
          {error && <span className="text-xs text-red-600 dark:text-red-400">{error}</span>}
        </div>
      )}
    </div>
  );
}
