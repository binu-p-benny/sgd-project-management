"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClientCombobox, type SelectedClient } from "@/components/clients/ClientCombobox";
import { Spinner } from "@/components/ui/Spinner";

const inputClass =
  "h-12 w-full rounded-lg border border-edge bg-bg px-3 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-sm font-medium text-fg-muted";

interface EditableFields {
  name: string;
  client: SelectedClient;
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
  const [form, setForm] = useState({
    name: initial.name,
    roughDesignCompletedAt: initial.roughDesignCompletedAt,
    notes: initial.notes,
  });
  const [client, setClient] = useState<SelectedClient | null>(initial.client);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
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

    if (!client) {
      setError("Select or add a client");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          clientId: client.id,
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
      className="flex flex-col gap-4 rounded-xl border border-edge bg-surface p-5 sm:p-6"
    >
      {error && (
        <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 ring-1 ring-inset ring-red-500/25 dark:text-red-400">
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

      <ClientCombobox id="client" value={client} onChange={setClient} />

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
          className="w-full rounded-lg border border-edge bg-bg px-3 py-2.5 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
      </div>

      <div className="rounded-lg bg-overlay px-3 py-2 text-xs text-fg-muted">
        Final cost, glass type, and workflow status aren&apos;t editable here — final cost is fixed
        by design, and the others are driven by the step timeline to avoid getting out of sync
        with it. Payment, and every step&apos;s status, blocking, and dates, are editable from the
        project page itself.
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="flex h-12 flex-1 items-center justify-center rounded-lg border border-edge text-base font-medium text-fg-muted transition-colors hover:border-edge-2 hover:text-fg"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex h-12 flex-1 items-center justify-center rounded-lg bg-accent text-base font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
        >
          {saving ? <Spinner className="h-4 w-4" /> : "Save changes"}
        </button>
      </div>
    </form>
  );
}
