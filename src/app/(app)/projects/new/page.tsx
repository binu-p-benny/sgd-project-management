"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

const inputClass =
  "h-12 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-700";
const labelClass = "text-sm font-medium text-zinc-700 dark:text-zinc-300";

export default function NewProjectPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    clientName: "",
    clientPhone: "",
    clientAddress: "",
    finalCost: "",
    glassType: "normal",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const finalCost = Number(form.finalCost);
    if (!Number.isFinite(finalCost) || finalCost <= 0) {
      setError("Enter a valid final cost");
      setLoading(false);
      return;
    }

    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, finalCost }),
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
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">New project</h1>

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
          className="mt-2 h-12 w-full rounded-lg bg-zinc-900 text-base font-medium text-white transition-colors hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
        >
          {loading ? "Creating..." : "Create project"}
        </button>
      </form>
    </div>
  );
}
