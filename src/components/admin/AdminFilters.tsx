"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { DEPARTMENT_LABELS } from "@/lib/labels";
import type { Department } from "@prisma/client";

const FILTERABLE_DEPARTMENTS: Department[] = [
  "hr_admin",
  "project_engineer",
  "design_engineer",
  "purchase",
  "accounts",
];

export function AdminFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setDepartment(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("department", value);
    } else {
      params.delete("department");
    }
    router.push(`/admin?${params.toString()}`);
  }

  return (
    <select
      aria-label="Filter by department"
      value={searchParams.get("department") ?? ""}
      onChange={(e) => setDepartment(e.target.value)}
      className="h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-700 sm:w-56"
    >
      <option value="">All departments</option>
      {FILTERABLE_DEPARTMENTS.map((dept) => (
        <option key={dept} value={dept}>
          {DEPARTMENT_LABELS[dept]}
        </option>
      ))}
    </select>
  );
}
