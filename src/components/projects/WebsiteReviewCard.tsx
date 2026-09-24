"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";

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

/**
 * Phase 3's own last card — a plain yes/no (did HR ask the client for a website review), not a
 * date+note record like PhaseReviewCard just above it on the page. Deliberately its own small
 * component rather than a third PhaseReviewCard instance: the answer is a boolean, not a date,
 * so the field shape genuinely differs, not just which Project columns it reads/writes. Same
 * "separate from the step timeline, no gate, nothing else reads it" spirit as that card though —
 * see the comment on Project.websiteReviewAsked in schema.prisma. Planned date is 3E's own
 * actual end date + 1 day, computed by the caller (see ProjectDetailPage) the same way
 * buildCustomerReviewTasks computes it for the matching HR & Admin /my-tasks row — this card and
 * that row answer the exact same question, so both must read as done/not-done together, which is
 * exactly what them both keying off websiteReviewAsked already guarantees.
 */
export function WebsiteReviewCard({
  projectId,
  plannedDate,
  asked,
  askedAt,
  note,
  canEdit,
}: {
  projectId: string;
  /** Display only — 3E's actual end date + 1 day, or null if 3E hasn't completed yet. */
  plannedDate: string | null;
  asked: boolean | null;
  askedAt: string | null;
  note: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [askedDraft, setAskedDraft] = useSyncedDraft(asked, (v) => v);
  const [noteDraft, setNoteDraft] = useSyncedDraft(note, (v) => v ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          websiteReviewAsked: askedDraft,
          websiteReviewedAt: askedDraft === null ? null : new Date().toISOString(),
          websiteReviewNote: noteDraft.trim() || null,
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
            <path d="M12 3 3 8.5V19a1 1 0 0 0 1 1h5v-6h6v6h5a1 1 0 0 0 1-1V8.5L12 3Z" strokeLinejoin="round" />
          </svg>
        </span>
        <div>
          <h3 className="font-medium text-fg">Website review</h3>
          <p className="text-xs text-fg-muted">Did HR ask the client for a website review? — HR &amp; Admin</p>
        </div>
      </div>

      <div className="flex flex-col gap-1 sm:w-1/3">
        <label className="text-xs font-medium text-fg-muted">Planned date</label>
        <input
          type="date"
          value={toDateInputValue(plannedDate)}
          disabled
          readOnly
          title="3E's own actual end date (Final QC on site) + 1 day — fixed, not editable here"
          className="h-10 w-full rounded-lg border border-edge bg-overlay px-2 text-sm text-fg-muted outline-none"
        />
        {!plannedDate && <p className="text-[11px] text-fg-subtle">Not yet — waiting on 3E&apos;s own final QC to complete.</p>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">Website review asked</label>
        {canEdit ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setAskedDraft(true)}
              disabled={submitting}
              className={`flex h-9 items-center justify-center rounded-lg px-4 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                askedDraft === true
                  ? "bg-emerald-600 text-white hover:bg-emerald-700"
                  : "border border-edge text-fg-muted hover:border-edge-2 hover:bg-overlay hover:text-fg"
              }`}
            >
              Yes
            </button>
            <button
              type="button"
              onClick={() => setAskedDraft(false)}
              disabled={submitting}
              className={`flex h-9 items-center justify-center rounded-lg px-4 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                askedDraft === false
                  ? "bg-red-600 text-white hover:bg-red-700"
                  : "border border-edge text-fg-muted hover:border-edge-2 hover:bg-overlay hover:text-fg"
              }`}
            >
              No
            </button>
          </div>
        ) : (
          <span className="flex h-9 items-center text-sm text-fg-muted">
            {asked === null ? "Not answered yet" : asked ? "Yes" : "No"}
            {askedAt && ` — ${formatDate(askedAt)}`}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">Note (optional)</label>
        {canEdit ? (
          <textarea
            rows={2}
            placeholder="Anything worth noting?"
            value={noteDraft}
            disabled={submitting}
            onChange={(e) => setNoteDraft(e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
        ) : (
          <p className="text-sm italic text-fg-muted">{note ? `"${note}"` : "—"}</p>
        )}
      </div>

      {canEdit && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={save}
            disabled={submitting || askedDraft === null}
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
