"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { PHASE_LABELS, OVERALL_STATUS_LABELS, DEPARTMENT_LABELS } from "@/lib/labels";

export function ProjectFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/projects?${params.toString()}`);
  }

  const selectClass =
    "h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-700 sm:w-44";

  return (
    <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
      <select
        aria-label="Filter by phase"
        className={selectClass}
        value={searchParams.get("phase") ?? ""}
        onChange={(e) => setParam("phase", e.target.value)}
      >
        <option value="">All phases</option>
        {Object.entries(PHASE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by status"
        className={selectClass}
        value={searchParams.get("status") ?? ""}
        onChange={(e) => setParam("status", e.target.value)}
      >
        <option value="">All statuses</option>
        {Object.entries(OVERALL_STATUS_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by department"
        className={selectClass}
        value={searchParams.get("department") ?? ""}
        onChange={(e) => setParam("department", e.target.value)}
      >
        <option value="">All departments</option>
        {Object.entries(DEPARTMENT_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </div>
  );
}
