"use client";

import { useState } from "react";
import Link from "next/link";
import { DeleteServiceButton } from "./DeleteServiceButton";
import { ServiceCompletionToggle } from "./ServiceCompletionToggle";
import { SERVICE_STATUS_LABELS, SERVICE_STATUS_COLORS } from "@/lib/labels";
import type { ServiceStatus } from "@/lib/service";

export interface ServiceListRow {
  id: string;
  title: string;
  completedAt: Date | null;
  client: { name: string };
  items: { actualDate: Date | null }[];
  status: ServiceStatus;
  statusDays: number | null;
  startedLabel: string;
}

type StatusFilter = "all" | ServiceStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Any status" },
  { value: "not_started", label: SERVICE_STATUS_LABELS.not_started },
  { value: "in_progress", label: SERVICE_STATUS_LABELS.in_progress },
  { value: "delayed", label: SERVICE_STATUS_LABELS.delayed },
  { value: "completed", label: SERVICE_STATUS_LABELS.completed },
  { value: "review_not_completed", label: SERVICE_STATUS_LABELS.review_not_completed },
];

const filterControlCls =
  "h-10 min-w-0 rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:h-8 sm:text-xs";
const clearBtnCls =
  "flex h-10 items-center justify-center rounded-lg border border-edge px-2.5 text-sm font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg sm:h-8 sm:text-xs";

/** Status badge text — label plus the same "· Nd" suffix convention the Projects list's Status
 *  badge uses (TaskCard/BlockedStepsWidget too), once a service has a delay to show. */
function formatServiceStatusLabel(status: ServiceStatus, days: number | null): string {
  const label = SERVICE_STATUS_LABELS[status];
  return days !== null && days > 0 ? `${label} · ${days}d` : label;
}

export function ServicesList({ services, canDelete }: { services: ServiceListRow[]; canDelete: boolean }) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const normalizedQuery = query.trim().toLowerCase();
  const filtersActive = normalizedQuery !== "" || statusFilter !== "all";
  const visible = services.filter((s) => {
    const matchesQuery =
      !normalizedQuery ||
      s.title.toLowerCase().includes(normalizedQuery) ||
      s.client.name.toLowerCase().includes(normalizedQuery);
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  function clearFilters() {
    setQuery("");
    setStatusFilter("all");
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search service, client…"
          className="h-10 w-full max-w-sm min-w-0 rounded-lg border border-edge bg-bg px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:h-8 sm:px-2 sm:text-xs"
        />
        <select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className={filterControlCls}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {filtersActive && (
          <>
            <button type="button" className={clearBtnCls} onClick={clearFilters}>
              Clear
            </button>
            <span className="text-xs text-fg-muted">
              {visible.length} of {services.length}
            </span>
          </>
        )}
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed border-teal-500/40 bg-teal-500/5 py-10 text-center text-sm text-fg-muted dark:border-teal-500/30 dark:bg-teal-500/[0.04]">
          No services match these filters.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {visible.map((service) => (
              <div
                key={service.id}
                className="flex flex-col gap-2 rounded-xl border border-teal-500/30 bg-teal-500/5 p-4 transition-colors hover:border-teal-500/50 dark:border-teal-500/25 dark:bg-teal-500/[0.04] dark:hover:border-teal-500/40"
              >
                <Link href={`/services/${service.id}`} className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-fg">{service.title}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SERVICE_STATUS_COLORS[service.status]}`}
                    >
                      {formatServiceStatusLabel(service.status, service.statusDays)}
                    </span>
                  </div>
                  <div className="text-sm text-fg-muted">{service.client.name}</div>
                  <div className="flex items-center justify-between text-sm text-fg-muted">
                    <span>{service.items.filter((i) => i.actualDate !== null).length} / {service.items.length} done</span>
                    <span className="text-xs text-fg-subtle">{service.startedLabel}</span>
                  </div>
                </Link>
                {canDelete && (
                  <div className="flex items-center justify-end gap-2 border-t border-edge pt-2">
                    <ServiceCompletionToggle serviceId={service.id} completed={service.completedAt !== null} />
                    <DeleteServiceButton serviceId={service.id} serviceTitle={service.title} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-teal-500/30 bg-teal-500/5 dark:border-teal-500/25 dark:bg-teal-500/[0.04] sm:block">
            <table className="w-full text-left text-sm">
              {/* Tinted rather than bg-surface — the wrapper's own wash sits behind the table
                  and is otherwise fully covered by these opaque rows, so the header is where
                  the teal identity actually needs to show. */}
              <thead className="bg-teal-500/10 text-[11px] uppercase tracking-wider text-fg-subtle dark:bg-teal-500/[0.08]">
                <tr>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Started</th>
                  <th className="px-4 py-3 font-medium">Work items</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  {canDelete && <th className="px-4 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {visible.map((service) => (
                  <tr key={service.id} className="cursor-pointer bg-surface transition-colors hover:bg-surface-2">
                    <td className="px-4 py-3">
                      <Link href={`/services/${service.id}`} className="font-medium text-fg hover:underline">
                        {service.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-fg-muted">{service.client.name}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-fg-muted">{service.startedLabel}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {service.items.filter((i) => i.actualDate !== null).length} / {service.items.length} done
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${SERVICE_STATUS_COLORS[service.status]}`}
                      >
                        {formatServiceStatusLabel(service.status, service.statusDays)}
                      </span>
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <ServiceCompletionToggle serviceId={service.id} completed={service.completedAt !== null} />
                          <DeleteServiceButton serviceId={service.id} serviceTitle={service.title} />
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
