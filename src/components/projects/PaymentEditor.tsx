"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAYMENT_STATUS_LABELS } from "@/lib/labels";
import { Spinner } from "@/components/ui/Spinner";
import { PAYMENT_MILESTONES, computeMilestoneAmount, type PaymentMilestoneTemplate } from "@/lib/payment-schedule";
import type { PaymentStatus } from "@prisma/client";

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(
    new Date(iso)
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.5} className={className}>
      <path d="M5 12.5 10 17l9-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className={className}>
      <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" strokeLinecap="round" />
    </svg>
  );
}

export type PaymentScheduleData = Record<`${PaymentMilestoneTemplate["key"]}ReceivedAt`, string | null>;

/** One row of the Payment schedule modal's table — the Token row marks itself received via the
 *  checkbox that sits in its own "Percentage / Token" cell (there's no percentage there to show
 *  instead); every other row uses the plain "Mark received" button in the Received column. Both
 *  paths hit the same PATCH — checked/clicked stamps now(), unchecked/Undo clears it back to
 *  null. */
function MilestoneRow({
  projectId,
  milestone,
  finalCost,
  receivedAt,
  canEdit,
  onSaved,
}: {
  projectId: string;
  milestone: PaymentMilestoneTemplate;
  finalCost: number;
  receivedAt: string | null;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isToken = milestone.percentage === null;
  const amount = computeMilestoneAmount(milestone.percentage, finalCost);
  const isReceived = !!receivedAt;

  async function setReceived(value: boolean) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/payment-schedule`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [`${milestone.key}ReceivedAt`]: value ? new Date().toISOString() : null }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Update failed");
        setSubmitting(false);
        return;
      }
      onSaved();
      setSubmitting(false);
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  return (
    <tr className="border-t border-edge">
      <td className="whitespace-nowrap px-3 py-2.5 text-sm font-medium text-fg">
        {isToken ? (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={isReceived}
              disabled={!canEdit || submitting}
              onChange={(e) => setReceived(e.target.checked)}
              className="size-4 accent-accent disabled:opacity-50"
            />
            Token
          </label>
        ) : (
          `${milestone.percentage}%`
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-fg">{amount !== null ? formatINR(amount) : "—"}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-fg-muted">{formatDate(receivedAt)}</td>
      <td className="whitespace-nowrap px-3 py-2.5">
        {isToken ? (
          isReceived && (
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="h-3.5 w-3.5 stroke-current" /> Received
            </span>
          )
        ) : isReceived ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
              <CheckIcon className="h-3.5 w-3.5 stroke-current" /> Received
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => setReceived(false)}
                disabled={submitting}
                className="text-xs text-fg-subtle underline decoration-dotted hover:text-fg disabled:opacity-40"
              >
                Undo
              </button>
            )}
          </div>
        ) : canEdit ? (
          <button
            type="button"
            onClick={() => setReceived(true)}
            disabled={submitting}
            className="flex h-8 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Mark received"}
          </button>
        ) : (
          <span className="text-xs text-fg-subtle">—</span>
        )}
        {error && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{error}</p>}
      </td>
    </tr>
  );
}

function PaymentScheduleModal({
  projectId,
  finalCost,
  paymentSchedule,
  canEdit,
  onClose,
  onSaved,
}: {
  projectId: string;
  finalCost: number;
  paymentSchedule: PaymentScheduleData;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-3 overflow-hidden rounded-xl border border-edge bg-surface p-5 shadow-[var(--shadow-sm)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-base font-semibold text-fg">Payment schedule</h3>
            <p className="text-xs text-fg-muted">Amounts are calculated from the final cost — {formatINR(finalCost)}.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted transition-colors hover:bg-overlay hover:text-fg"
          >
            <CloseIcon className="h-4 w-4 stroke-current" />
          </button>
        </div>
        <div className="overflow-auto rounded-lg border border-edge">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="bg-overlay text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Percentage / Token</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Amount</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Date</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Received</th>
              </tr>
            </thead>
            <tbody>
              {PAYMENT_MILESTONES.map((milestone) => (
                <MilestoneRow
                  key={milestone.key}
                  projectId={projectId}
                  milestone={milestone}
                  finalCost={finalCost}
                  receivedAt={paymentSchedule[`${milestone.key}ReceivedAt`]}
                  canEdit={canEdit}
                  onSaved={onSaved}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function PaymentEditor({
  projectId,
  paymentStatus,
  amountReceived,
  finalCost,
  notes,
  canEdit,
  paymentSchedule,
}: {
  projectId: string;
  paymentStatus: PaymentStatus;
  amountReceived: number;
  finalCost: number;
  notes: string | null;
  canEdit: boolean;
  paymentSchedule: PaymentScheduleData;
}) {
  const router = useRouter();
  const [amountInput, setAmountInput] = useState(String(amountReceived));
  const [notesDraft, setNotesDraft] = useState(notes ?? "");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  async function patch(body: Record<string, unknown>, field: string) {
    setSaving(field);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Update failed");
        setSaving(null);
        return;
      }
      router.refresh();
      setSaving(null);
    } catch {
      setError("Could not reach the server");
      setSaving(null);
    }
  }

  const scheduleButton = (
    <button
      type="button"
      onClick={() => setScheduleOpen(true)}
      className="mt-1 flex w-fit items-center gap-1 text-xs font-medium text-accent hover:underline"
    >
      Payment schedule
    </button>
  );

  const modal = scheduleOpen && (
    <PaymentScheduleModal
      projectId={projectId}
      finalCost={finalCost}
      paymentSchedule={paymentSchedule}
      canEdit={canEdit}
      onClose={() => setScheduleOpen(false)}
      onSaved={() => router.refresh()}
    />
  );

  if (!canEdit) {
    return (
      <div>
        <div className="text-fg-subtle">Payment</div>
        <div className="font-medium text-fg">
          {PAYMENT_STATUS_LABELS[paymentStatus]} ({formatINR(amountReceived)} received)
        </div>
        {notes && <div className="mt-1 text-xs italic text-fg-muted">&ldquo;{notes}&rdquo;</div>}
        {scheduleButton}
        {modal}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-1.5 text-fg-subtle">
        Payment
        {saving && <Spinner className="h-3 w-3 text-accent" />}
      </div>
      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex min-w-0 flex-col gap-2">
        <select
          value={paymentStatus}
          disabled={saving === "paymentStatus"}
          onChange={(e) => patch({ paymentStatus: e.target.value }, "paymentStatus")}
          className="h-11 w-full min-w-0 rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
        >
          {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex min-w-0 items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            min="0"
            max={finalCost}
            value={amountInput}
            disabled={saving === "amountReceived"}
            onChange={(e) => setAmountInput(e.target.value)}
            onBlur={() => {
              const value = Number(amountInput);
              if (Number.isFinite(value) && value >= 0) {
                patch({ amountReceived: value }, "amountReceived");
              }
            }}
            className="h-11 w-24 min-w-0 flex-1 rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
          <span className="shrink-0 text-xs text-fg-muted">of {formatINR(finalCost)}</span>
        </div>
        <textarea
          rows={2}
          placeholder="Note (optional)"
          value={notesDraft}
          disabled={saving === "notes"}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => {
            if (notesDraft !== (notes ?? "")) patch({ notes: notesDraft || null }, "notes");
          }}
          className="w-full min-w-0 resize-none rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
        />
      </div>
      {scheduleButton}
      {modal}
    </div>
  );
}
