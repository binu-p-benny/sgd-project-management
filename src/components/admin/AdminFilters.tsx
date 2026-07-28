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
      className="h-11 w-full rounded-lg border border-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:w-56"
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
