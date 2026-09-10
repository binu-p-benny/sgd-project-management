"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";

const inputClass =
  "h-12 w-full rounded-lg border border-edge bg-bg px-3 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-sm font-medium text-fg-muted";

export default function NewClientPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", address: "" });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not add client");
        setLoading(false);
        return;
      }

      router.push("/clients");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <h1 className="text-xl font-semibold text-fg">Add client</h1>

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
            Client name
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
          <label htmlFor="phone" className={labelClass}>
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            required
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="address" className={labelClass}>
            Address
          </label>
          <textarea
            id="address"
            required
            rows={3}
            value={form.address}
            onChange={(e) => update("address", e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2.5 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-lg bg-accent text-base font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
        >
          {loading ? <Spinner className="h-4 w-4" /> : "Add client"}
        </button>
      </form>
    </div>
  );
}
