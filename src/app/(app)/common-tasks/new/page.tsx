"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import { ASSIGNABLE_DEPARTMENTS, DEPARTMENT_LABELS, RECURRENCE_OPTIONS, RECURRENCE_LABELS } from "@/lib/labels";

const inputClass =
  "h-12 w-full rounded-lg border border-edge bg-bg px-3 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-sm font-medium text-fg-muted";

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewCommonTaskPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    taskLabel: "",
    department: ASSIGNABLE_DEPARTMENTS[0],
    recurrence: "none" as (typeof RECURRENCE_OPTIONS)[number],
    plannedDate: todayInputValue(),
    note: "",
  });

  function update<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch("/api/common-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskLabel: form.taskLabel,
          department: form.department,
          recurrence: form.recurrence,
          plannedDate: new Date(form.plannedDate).toISOString(),
          note: form.note.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(typeof body.error === "string" ? body.error : "Could not add task");
        setLoading(false);
        return;
      }

      router.push("/common-tasks");
      router.refresh();
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-5">
      <h1 className="text-xl font-semibold text-fg">Add common task</h1>

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
          <label htmlFor="taskLabel" className={labelClass}>
            Task
          </label>
          <input
            id="taskLabel"
            required
            placeholder="e.g. Weekly office supplies check"
            value={form.taskLabel}
            onChange={(e) => update("taskLabel", e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="department" className={labelClass}>
            Department
          </label>
          <select
            id="department"
            value={form.department}
            onChange={(e) => update("department", e.target.value as typeof form.department)}
            className={inputClass}
          >
            {ASSIGNABLE_DEPARTMENTS.map((d) => (
              <option key={d} value={d}>
                {DEPARTMENT_LABELS[d]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="recurrence" className={labelClass}>
            Recurs
          </label>
          <select
            id="recurrence"
            value={form.recurrence}
            onChange={(e) => update("recurrence", e.target.value as typeof form.recurrence)}
            className={inputClass}
          >
            {RECURRENCE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {RECURRENCE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="plannedDate" className={labelClass}>
            {form.recurrence === "none" ? "Due date" : "First due date"}
          </label>
          <input
            id="plannedDate"
            type="date"
            required
            value={form.plannedDate}
            onChange={(e) => update("plannedDate", e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="note" className={labelClass}>
            Note (optional)
          </label>
          <textarea
            id="note"
            rows={3}
            value={form.note}
            onChange={(e) => update("note", e.target.value)}
            className="w-full rounded-lg border border-edge bg-bg px-3 py-2.5 text-base text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="mt-2 flex h-12 w-full items-center justify-center rounded-lg bg-accent text-base font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
        >
          {loading ? <Spinner className="h-4 w-4" /> : "Add task"}
        </button>
      </form>
    </div>
  );
}
