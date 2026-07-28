"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MyTaskItem } from "@/lib/my-tasks";
import {
  STEP_STATUS_LABELS,
  STEP_STATUS_COLORS,
  BLOCKED_REASON_LABELS,
  BLOCKED_REASON_OPTIONS,
  DEPARTMENT_LABELS,
} from "@/lib/labels";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(iso));
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

// Some browsers only open the native calendar when the small icon is clicked, not
// the rest of the field — showPicker() makes the whole input open it on any click.
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

const DATE_FIELDS: { key: "plannedStartDate" | "plannedEndDate" | "actualStartDate" | "actualEndDate"; label: string }[] = [
  { key: "plannedStartDate", label: "Planned start" },
  { key: "plannedEndDate", label: "Planned end" },
  { key: "actualStartDate", label: "Actual start" },
  { key: "actualEndDate", label: "Actual end" },
];

const btnPrimary =
  "flex-1 flex h-11 items-center justify-center rounded-lg bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-40";
const btnSecondary =
  "flex-1 flex h-11 items-center justify-center rounded-lg border border-edge px-3 text-sm font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-white/[0.04] hover:text-fg disabled:opacity-40";
const selectClass =
  "h-11 w-full rounded-lg border border-edge bg-bg px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const textareaClass =
  "w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";

type Panel = "none" | "block" | "complete1a" | "dates";

export function TaskCard({
  item,
  showDepartment = false,
  canEditDates = false,
}: {
  item: MyTaskItem;
  showDepartment?: boolean;
  canEditDates?: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>("none");
  const [blockedReason, setBlockedReason] = useState("");
  const [blockedNote, setBlockedNote] = useState("");
  const [visitUrgency, setVisitUrgency] = useState("");
  const [dateFields, setDateFields] = useState({
    plannedStartDate: toDateInputValue(item.plannedStartDate),
    plannedEndDate: toDateInputValue(item.plannedEndDate),
    actualStartDate: toDateInputValue(item.actualStartDate),
    actualEndDate: toDateInputValue(item.actualEndDate),
  });
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(body: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/phase-steps/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        const detail = data.detail?.blockedBy ? ` (waiting on: ${data.detail.blockedBy.join(", ")})` : "";
        setError((typeof data.error === "string" ? data.error : "Update failed") + detail);
        setSubmitting(false);
        return;
      }
      setPanel("none");
      setNote("");
      router.refresh();
      setSubmitting(false);
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  function startStep() {
    submit({ status: "in_progress", notes: note || undefined });
  }

  function resumeStep() {
    submit({ status: "in_progress", notes: note || undefined });
  }

  function completeStep() {
    if (item.stepCode === "1A") {
      setPanel("complete1a");
      return;
    }
    submit({ status: "completed", notes: note || undefined });
  }

  function confirmBlock() {
    if (!blockedReason) {
      setError("Choose a reason");
      return;
    }
    if (blockedReason === "other" && !blockedNote.trim()) {
      setError("A note is required for 'Other'");
      return;
    }
    submit({ status: "blocked", blockedReason, blockedNote: blockedNote || undefined });
  }

  function confirmComplete1A() {
    if (!visitUrgency) {
      setError("Choose the visit urgency");
      return;
    }
    submit({ status: "completed", visitUrgency, notes: note || undefined });
  }

  async function confirmDates() {
    setSubmitting(true);
    setError(null);
    const body: Record<string, unknown> = { note: note || undefined };
    for (const { key } of DATE_FIELDS) {
      body[key] = dateFields[key] ? new Date(dateFields[key]).toISOString() : null;
    }
    try {
      const res = await fetch(`/api/phase-steps/${item.id}/dates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Update failed");
        setSubmitting(false);
        return;
      }
      setPanel("none");
      setNote("");
      router.refresh();
      setSubmitting(false);
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  const canStartOrComplete = item.gateBlockedBy === null || item.gateBlockedBy.length === 0;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/projects/${item.project.id}`}
            className="text-xs font-medium text-fg-muted hover:text-fg hover:underline"
          >
            {item.project.name}
          </Link>
          <div className="mt-0.5">
            <span className="font-mono text-xs text-fg-subtle">{item.stepCode}</span>{" "}
            <span className="font-medium text-fg">{item.stepName}</span>
          </div>
          {showDepartment && (
            <span className="mt-1 inline-block rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] font-medium text-fg-muted ring-1 ring-inset ring-white/10">
              {DEPARTMENT_LABELS[item.owningDepartment]}
            </span>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STEP_STATUS_COLORS[item.status]}`}>
            {STEP_STATUS_LABELS[item.status]}
          </span>
          {item.overrun && item.status !== "blocked" && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/25">
              Overdue
            </span>
          )}
        </div>
      </div>

      <div className="text-xs text-fg-muted">Planned finish: {formatDate(item.plannedEndDate)}</div>

      {item.status === "blocked" && item.blockedReason && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-inset ring-red-500/25">
          <div className="font-medium">
            {BLOCKED_REASON_LABELS[item.blockedReason as keyof typeof BLOCKED_REASON_LABELS]}
            {item.daysBlocked !== null && ` · blocked ${item.daysBlocked}d`}
          </div>
          {item.blockedNote && <div className="mt-0.5">{item.blockedNote}</div>}
        </div>
      )}

      {item.isDerived && item.derivedSummary && (
        <div className="rounded-lg bg-white/[0.06] px-3 py-2 text-xs text-fg-muted">
          Auto-computed from procurement —{" "}
          {item.derivedSummary.map((d) => `${d.itemType}: ${d.done ? "done" : "pending"}`).join(", ")}
        </div>
      )}

      {item.notes && (
        <div className="rounded-lg bg-white/[0.06] px-3 py-2 text-xs italic text-fg-muted">
          &ldquo;{item.notes}&rdquo;
        </div>
      )}

      {!item.isDerived && !canStartOrComplete && item.gateBlockedBy && (
        <div className="rounded-lg bg-white/[0.06] px-3 py-2 text-xs text-fg-muted">
          Waiting on: {item.gateBlockedBy.join(", ")}
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-inset ring-red-500/25">
          {error}
        </div>
      )}

      {panel === "block" && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <select
            className={selectClass}
            value={blockedReason}
            onChange={(e) => setBlockedReason(e.target.value)}
          >
            <option value="">Select a reason…</option>
            {BLOCKED_REASON_OPTIONS.map((reason) => (
              <option key={reason} value={reason}>
                {BLOCKED_REASON_LABELS[reason]}
              </option>
            ))}
          </select>
          <textarea
            className={textareaClass}
            rows={2}
            placeholder={blockedReason === "other" ? "Note (required)" : "Note (optional)"}
            value={blockedNote}
            onChange={(e) => setBlockedNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => setPanel("none")} disabled={submitting}>
              Cancel
            </button>
            <button className={btnPrimary} onClick={confirmBlock} disabled={submitting}>
              {submitting ? "Saving…" : "Confirm block"}
            </button>
          </div>
        </div>
      )}

      {panel === "complete1a" && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <label className="text-xs font-medium text-fg-muted">
            Visit urgency (sets 1B&apos;s schedule)
          </label>
          <select
            className={selectClass}
            value={visitUrgency}
            onChange={(e) => setVisitUrgency(e.target.value)}
          >
            <option value="">Select…</option>
            <option value="emergency">Emergency (2 days)</option>
            <option value="hot">Hot (5 days)</option>
            <option value="cold">Cold (15 days)</option>
            <option value="site_not_ready">Site not ready (blocks 1B)</option>
          </select>
          <textarea
            className={textareaClass}
            rows={2}
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => setPanel("none")} disabled={submitting}>
              Cancel
            </button>
            <button className={btnPrimary} onClick={confirmComplete1A} disabled={submitting}>
              {submitting ? "Saving…" : "Confirm complete"}
            </button>
          </div>
        </div>
      )}

      {panel === "dates" && (
        <div className="flex flex-col gap-2 border-t border-edge pt-3">
          <div className="grid grid-cols-2 gap-2">
            {DATE_FIELDS.map(({ key, label }) => (
              <div key={key} className="flex flex-col gap-1">
                <label className="text-xs font-medium text-fg-muted">{label}</label>
                <input
                  type="date"
                  value={dateFields[key]}
                  onChange={(e) => setDateFields((prev) => ({ ...prev, [key]: e.target.value }))}
                  onClick={openPicker}
                  className="h-11 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-fg-subtle">
            Not-yet-completed downstream steps will be rescheduled automatically.
          </p>
          <textarea
            className={textareaClass}
            rows={2}
            placeholder="Note (optional) — why the dates changed"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="flex gap-2">
            <button className={btnSecondary} onClick={() => setPanel("none")} disabled={submitting}>
              Cancel
            </button>
            <button className={btnPrimary} onClick={confirmDates} disabled={submitting}>
              {submitting ? "Saving…" : "Save dates"}
            </button>
          </div>
        </div>
      )}

      {panel === "none" && canEditDates && (
        <button
          className="flex h-9 items-center justify-center rounded-lg border border-edge px-3 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:text-fg"
          onClick={() => setPanel("dates")}
        >
          Edit dates
        </button>
      )}

      {panel === "none" && !item.isDerived && item.status !== "completed" && (
        <textarea
          className={textareaClass}
          rows={2}
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      )}

      {panel === "none" && !item.isDerived && (
        <div className="flex gap-2">
          {item.status === "not_started" && (
            <>
              <button className={btnPrimary} onClick={startStep} disabled={submitting || !canStartOrComplete}>
                Start
              </button>
              <button className={btnSecondary} onClick={() => setPanel("block")} disabled={submitting}>
                Report blocked
              </button>
            </>
          )}
          {item.status === "in_progress" && (
            <>
              <button className={btnPrimary} onClick={completeStep} disabled={submitting || !canStartOrComplete}>
                Mark complete
              </button>
              <button className={btnSecondary} onClick={() => setPanel("block")} disabled={submitting}>
                Report blocked
              </button>
            </>
          )}
          {item.status === "blocked" && (
            <button className={btnPrimary} onClick={resumeStep} disabled={submitting}>
              Resume
            </button>
          )}
        </div>
      )}
    </div>
  );
}
