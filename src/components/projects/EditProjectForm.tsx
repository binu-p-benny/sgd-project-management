"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-700";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

interface EditableFields {
  name: string;
  clientName: string;
  clientPhone: string;
  clientAddress: string;
  roughDesignCompletedAt: string; // yyyy-mm-dd or ""
  notes: string;
}

export function EditProjectForm({
  projectId,
  initial,
}: {
  projectId: string;
  initial: EditableFields;
}) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof EditableFields>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          clientName: form.clientName,
          clientPhone: form.clientPhone,
          clientAddress: form.clientAddress,
          roughDesignCompletedAt: form.roughDesignCompletedAt
            ? new Date(form.roughDesignCompletedAt).toISOString()
            : null,
          notes: form.notes || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not save changes");
        setSaving(false);
        return;
      }

      router.push(`/projects/${projectId}`);
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 sm:p-6"
    >
      {error && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <label htmlFor="name" className={labelClass}>
          Project name
        </label>
        <input
          id="name"
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="clientName" className={labelClass}>
          Client name
        </label>
        <input
          id="clientName"
          required
          value={form.clientName}
          onChange={(e) => update("clientName", e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="clientPhone" className={labelClass}>
          Client phone
        </label>
        <input
          id="clientPhone"
          type="tel"
          required
          value={form.clientPhone}
          onChange={(e) => update("clientPhone", e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="clientAddress" className={labelClass}>
          Client address
        </label>
        <textarea
          id="clientAddress"
          required
          rows={3}
          value={form.clientAddress}
          onChange={(e) => update("clientAddress", e.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-700"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="roughDesignCompletedAt" className={labelClass}>
          Rough design completed on
        </label>
        <input
          id="roughDesignCompletedAt"
          type="date"
          value={form.roughDesignCompletedAt}
          onChange={(e) => update("roughDesignCompletedAt", e.target.value)}
          onClick={openPicker}
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="notes" className={labelClass}>
          Note
        </label>
        <textarea
          id="notes"
          rows={3}
          placeholder="Note (optional) — administrative context about this project"
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-700"
        />
      </div>

      <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
        Final cost, glass type, and workflow status aren&apos;t editable here — final cost is fixed
        by design, and the others are driven by the step timeline to avoid getting out of sync
        with it. Payment, and every step&apos;s status, blocking, and dates, are editable from the
        project page itself.
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-12 flex-1 items-center justify-center rounded-lg border border-zinc-300 text-base font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex h-12 flex-1 items-center justify-center rounded-lg bg-zinc-900 text-base font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
