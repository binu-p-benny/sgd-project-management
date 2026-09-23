"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { DEPARTMENT_LABELS, ASSIGNABLE_DEPARTMENTS } from "@/lib/labels";

/** Shared by /admin and /open-work — both are "every open X, optionally narrowed to one
 *  department" pages with an identical dropdown, just reading a different underlying task set.
 *  basePath defaults to /admin's own route so every existing call site keeps working unchanged. */
export function AdminFilters({ basePath = "/admin" }: { basePath?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setDepartment(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("department", value);
    } else {
      params.delete("department");
    }
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <select
      aria-label="Filter by department"
      value={searchParams.get("department") ?? ""}
      onChange={(e) => setDepartment(e.target.value)}
      className="h-11 w-full rounded-lg border border-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:w-56"
    >
      <option value="">All departments</option>
      {ASSIGNABLE_DEPARTMENTS.map((dept) => (
        <option key={dept} value={dept}>
          {DEPARTMENT_LABELS[dept]}
        </option>
      ))}
    </select>
  );
}
