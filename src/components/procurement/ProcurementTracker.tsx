"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface ProcurementItemData {
  id: string;
  itemType: string;
  requirementCreatedAt: string | null;
  quoteCreatedAt: string | null;
  orderConfirmedAt: string | null;
  paymentSettledAt: string | null;
  paymentDetails: string | null;
  expectedArrivalDate: string | null;
  actualArrivalDate: string | null;
  qcCheckedAt: string | null;
  overrun: boolean;
  notes: string | null;
}

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

type CheckboxDateKey =
  | "requirementCreatedAt"
  | "quoteCreatedAt"
  | "paymentSettledAt"
  | "actualArrivalDate"
  | "qcCheckedAt";

// Split in two so "Order confirmed" and "Payment details" can render between them,
// keeping the card in its natural chronological order: requirement -> quote -> payment
// -> order -> arrival -> QC.
const EARLY_CHECKBOX_FIELDS: { dateKey: CheckboxDateKey; label: string }[] = [
  { dateKey: "requirementCreatedAt", label: "Requirement created" },
  { dateKey: "quoteCreatedAt", label: "Quote created" },
  { dateKey: "paymentSettledAt", label: "Payment done" },
];
const LATE_CHECKBOX_FIELDS: { dateKey: CheckboxDateKey; label: string }[] = [
  { dateKey: "actualArrivalDate", label: "Actual arrival" },
  { dateKey: "qcCheckedAt", label: "QC checked" },
];

function ItemCard({
  item,
  canEdit,
  canEditRequirement,
}: {
  item: ProcurementItemData;
  canEdit: boolean;
  canEditRequirement: boolean;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState(item.notes ?? "");
  const [paymentDetailsDraft, setPaymentDetailsDraft] = useState(item.paymentDetails ?? "");
  const hiddenDateInputs = useRef<Partial<Record<CheckboxDateKey, HTMLInputElement | null>>>({});

  async function patch(body: Record<string, unknown>, field: string) {
    setSaving(field);
    setError(null);
    try {
      const res = await fetch(`/api/procurement-items/${item.id}`, {
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

  function handleDateChange(key: keyof ProcurementItemData, value: string) {
    patch({ [key]: value ? new Date(value).toISOString() : null }, key);
  }

  // Checking one of these boxes doesn't stamp "today" — it opens that field's own
  // native date picker so the actual date can be chosen, same as picking any other
  // date field. Unchecking needs no picker; it just clears the date directly.
  function handleCheckboxClick(e: React.MouseEvent<HTMLInputElement>, dateKey: CheckboxDateKey, checked: boolean) {
    e.preventDefault();
    if (checked) {
      patch({ [dateKey]: null }, dateKey);
      return;
    }
    const input = hiddenDateInputs.current[dateKey];
    if (input && typeof input.showPicker === "function") {
      try {
        input.showPicker();
      } catch {
        // no-op: unsupported in this browser, or not triggered by a direct user gesture
      }
    }
  }

  function handleHiddenDateChange(dateKey: CheckboxDateKey, value: string) {
    if (!value) return; // cleared/cancelled in the picker — nothing chosen, nothing to save
    patch({ [dateKey]: new Date(value).toISOString() }, dateKey);
  }

  function renderCheckboxField({ dateKey, label }: { dateKey: CheckboxDateKey; label: string }) {
    const editable = dateKey === "requirementCreatedAt" ? canEditRequirement : canEdit;
    const checked = item[dateKey] !== null;
    return (
      <label
        key={dateKey}
        className="flex h-11 items-center gap-3 rounded-lg border border-edge px-3"
      >
        <span className="relative inline-flex h-5 w-5 shrink-0">
          <input
            type="checkbox"
            checked={checked}
            disabled={!editable || saving === dateKey}
            onClick={(e) => editable && handleCheckboxClick(e, dateKey, checked)}
            onChange={() => {}}
            className="h-5 w-5 rounded border-edge-2 accent-accent"
          />
          {/* Invisible but real-sized (not clipped to 1px, unlike sr-only) — Chromium
              won't anchor showPicker()'s popup to an element with no meaningful box.
              pointer-events-none so it never steals the checkbox's own clicks. */}
          <input
            ref={(el) => {
              hiddenDateInputs.current[dateKey] = el;
            }}
            type="date"
            value={toDateInputValue(item[dateKey] as string | null)}
            onChange={(e) => handleHiddenDateChange(dateKey, e.target.value)}
            tabIndex={-1}
            aria-hidden="true"
            className="absolute inset-0 h-5 w-5 pointer-events-none opacity-0"
          />
        </span>
        <span className="text-sm text-fg-muted">
          {label}
          {item[dateKey] ? ` · ${formatDate(item[dateKey] as string | null)}` : ""}
        </span>
      </label>
    );
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

  function handleNotesBlur() {
    if (notesDraft !== (item.notes ?? "")) {
      patch({ notes: notesDraft || null }, "notes");
    }
  }

  function handlePaymentDetailsBlur() {
    if (paymentDetailsDraft !== (item.paymentDetails ?? "")) {
      patch({ paymentDetails: paymentDetailsDraft || null }, "paymentDetails");
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-edge bg-surface p-4">
      <div className="flex items-center justify-between">
        <span className="font-medium capitalize text-fg">{item.itemType}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-fg-muted">Expected: {formatDate(item.expectedArrivalDate)}</span>
          {item.overrun && (
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400 ring-1 ring-inset ring-amber-500/25">
              Overdue
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400 ring-1 ring-inset ring-red-500/25">
          {error}
        </div>
      )}

      {EARLY_CHECKBOX_FIELDS.map(renderCheckboxField)}

      {canEdit ? (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Payment details</label>
          <input
            type="text"
            placeholder="e.g. NEFT ref #12345, ₹50,000"
            value={paymentDetailsDraft}
            disabled={saving === "paymentDetails"}
            onChange={(e) => setPaymentDetailsDraft(e.target.value)}
            onBlur={handlePaymentDetailsBlur}
            className="h-11 w-full rounded-lg border border-edge bg-bg px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
        </div>
      ) : (
        item.paymentDetails && (
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-muted">Payment details</span>
            <span className="text-sm text-fg-muted">{item.paymentDetails}</span>
          </div>
        )
      )}

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-fg-muted">Order confirmed</label>
        {canEdit ? (
          <input
            type="date"
            value={toDateInputValue(item.orderConfirmedAt)}
            disabled={saving === "orderConfirmedAt"}
            onChange={(e) => handleDateChange("orderConfirmedAt", e.target.value)}
            onClick={openPicker}
            className="h-11 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
        ) : (
          <span className="text-sm text-fg-muted">{formatDate(item.orderConfirmedAt)}</span>
        )}
      </div>

      {LATE_CHECKBOX_FIELDS.map(renderCheckboxField)}

      {canEdit ? (
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-fg-muted">Note</label>
          <textarea
            rows={2}
            placeholder="Note (optional)"
            value={notesDraft}
            disabled={saving === "notes"}
            onChange={(e) => setNotesDraft(e.target.value)}
            onBlur={handleNotesBlur}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-50"
          />
        </div>
      ) : (
        item.notes && (
          <div className="rounded-lg bg-white/[0.06] px-3 py-2 text-xs italic text-fg-muted">
            &ldquo;{item.notes}&rdquo;
          </div>
        )
      )}
    </div>
  );
}

export function ProcurementTracker({
  items,
  canEdit,
  canEditRequirement,
}: {
  items: ProcurementItemData[];
  canEdit: boolean;
  /** Design Engineer (2A's owner) can check "Requirement created" even without full Purchase access. */
  canEditRequirement: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold text-fg">Procurement</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {items.map((item) => (
          <ItemCard key={item.id} item={item} canEdit={canEdit} canEditRequirement={canEdit || canEditRequirement} />
        ))}
      </div>
    </div>
  );
}
