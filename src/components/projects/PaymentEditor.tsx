"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { PAYMENT_STATUS_LABELS } from "@/lib/labels";
import type { PaymentStatus } from "@prisma/client";

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function PaymentEditor({
  projectId,
  paymentStatus,
  amountReceived,
  finalCost,
  notes,
  canEdit,
}: {
  projectId: string;
  paymentStatus: PaymentStatus;
  amountReceived: number;
  finalCost: number;
  notes: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [amountInput, setAmountInput] = useState(String(amountReceived));
  const [notesDraft, setNotesDraft] = useState(notes ?? "");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (!canEdit) {
    return (
      <div>
        <div className="text-zinc-400 dark:text-zinc-500">Payment</div>
        <div className="font-medium text-zinc-900 dark:text-zinc-50">
          {PAYMENT_STATUS_LABELS[paymentStatus]} ({formatINR(amountReceived)} received)
        </div>
        {notes && <div className="mt-1 text-xs italic text-zinc-500 dark:text-zinc-400">&ldquo;{notes}&rdquo;</div>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="text-zinc-400 dark:text-zinc-500">Payment</div>
      {error && <div className="text-xs text-red-600 dark:text-red-400">{error}</div>}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <select
          value={paymentStatus}
          disabled={saving === "paymentStatus"}
          onChange={(e) => patch({ paymentStatus: e.target.value }, "paymentStatus")}
          className="h-11 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
        >
          {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2">
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
            className="h-11 w-32 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50"
          />
          <span className="text-xs text-zinc-500 dark:text-zinc-400">of {formatINR(finalCost)}</span>
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
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 sm:max-w-xs"
        />
      </div>
    </div>
  );
}
