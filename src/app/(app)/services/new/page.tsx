"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ClientCombobox, type SelectedClient } from "@/components/clients/ClientCombobox";
import { Spinner } from "@/components/ui/Spinner";
import { ASSIGNABLE_DEPARTMENTS, DEPARTMENT_LABELS } from "@/lib/labels";

const inputClass =
  "h-12 w-full rounded-lg border border-edge bg-bg px-3 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-sm font-medium text-fg-muted";

export default function NewServicePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [client, setClient] = useState<SelectedClient | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    // Matches the field's own DB default (see the ServiceItem schema) — picking anything else
    // here is opt-in, not a change to today's behavior.
    actionPlanDepartment: "purchase",
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

    setLoading(true);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, clientId: client.id }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not create service");
        setLoading(false);
        return;
      }

      const service = await res.json();
      router.push(`/services/${service.id}`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <h1 className="text-xl font-semibold text-fg">New service</h1>

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
          <label htmlFor="title" className={labelClass}>
            Service title
          </label>
          <input
            id="title"
            required
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            className={inputClass}
          />
        </div>

        <ClientCombobox id="client" value={client} onChange={setClient} />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="description" className={labelClass}>
            Service description
          </label>
          <textarea
            id="description"
            rows={3}
            value={form.description}
            onChange={(e) => update("description", e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2.5 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="actionPlanDepartment" className={labelClass}>
            Action plan department
          </label>
          <select
            id="actionPlanDepartment"
            value={form.actionPlanDepartment}
            onChange={(e) => update("actionPlanDepartment", e.target.value)}
            className={inputClass}
          >
            {ASSIGNABLE_DEPARTMENTS.map((dept) => (
              <option key={dept} value={dept}>
                {DEPARTMENT_LABELS[dept]}
              </option>
            ))}
          </select>
          <p className="text-xs text-fg-subtle">
            Who the service&apos;s first work item — &ldquo;Action plan&rdquo; — starts assigned to.
          </p>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-lg bg-accent text-base font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
        >
          {loading ? <Spinner className="h-4 w-4" /> : "Create service"}
        </button>
      </form>
    </div>
  );
}
