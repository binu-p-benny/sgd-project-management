"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClientCombobox, type SelectedClient } from "@/components/clients/ClientCombobox";
import { Spinner } from "@/components/ui/Spinner";

const inputClass =
  "h-12 w-full rounded-lg border border-edge bg-bg px-3 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-sm font-medium text-fg-muted";

export default function NewProjectPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [client, setClient] = useState<SelectedClient | null>(null);
  const [form, setForm] = useState({
    name: "",
    finalCost: "",
    glassType: "normal",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!client) {
      setError("Select or add a client");
      return;
    }

    const finalCost = Number(form.finalCost);
    if (!Number.isFinite(finalCost) || finalCost <= 0) {
      setError("Enter a valid final cost");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, clientId: client.id, finalCost }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not create project");
        setLoading(false);
        return;
      }

      const project = await res.json();
      router.push(`/projects/${project.id}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <h1 className="text-xl font-semibold text-fg">New project</h1>

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
          <label htmlFor="finalCost" className={labelClass}>
            Final cost (INR)
          </label>
          <input
            id="finalCost"
            type="number"
            inputMode="numeric"
            min="1"
            step="1"
            required
            value={form.finalCost}
            onChange={(e) => update("finalCost", e.target.value)}
            className={inputClass}
            placeholder="e.g. 1250000"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="glassType" className={labelClass}>
            Glass type
          </label>
          <select
            id="glassType"
            value={form.glassType}
            onChange={(e) => update("glassType", e.target.value)}
            className={inputClass}
          >
            <option value="normal">Normal</option>
            <option value="laminated">Laminated</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-lg bg-accent text-base font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
        >
          {loading ? <Spinner className="h-4 w-4" /> : "Create project"}
        </button>
      </form>
    </div>
  );
}
