import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { DeleteServiceButton } from "@/components/services/DeleteServiceButton";
import { ServiceCompletionToggle } from "@/components/services/ServiceCompletionToggle";
import { getServiceStatus, type ServiceStatus } from "@/lib/service";
import { isProcurementStageOverrun, daysBlocked } from "@/lib/overrun";
import { SERVICE_STATUS_LABELS, SERVICE_STATUS_COLORS } from "@/lib/labels";

/** How long a service has been open — same createdAt anchor and wording as the Projects list's
 *  own "Started" column. */
function formatDaysSince(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

/** Days since the earliest still-open item's planned date passed — the exact date
 *  getServiceStatus's own hasOverdueItem check is keyed off of. Null once nothing's overdue.
 *  Services have no "blocked" state to match Projects', so this only ever feeds "delayed". */
function getServiceDelayDays(items: { plannedDate: Date; actualDate: Date | null }[]): number | null {
  const overdue = items
    .filter((i) => isProcurementStageOverrun(i.plannedDate, i.actualDate))
    .sort((a, b) => a.plannedDate.getTime() - b.plannedDate.getTime());
  return overdue[0] ? daysBlocked(overdue[0].plannedDate) : null;
}

/** Status badge text — label plus the same "· Nd" suffix convention the Projects list's Status
 *  badge uses (TaskCard/BlockedStepsWidget too), once getServiceDelayDays has something to show. */
function formatServiceStatusLabel(status: ServiceStatus, days: number | null): string {
  const label = SERVICE_STATUS_LABELS[status];
  return days !== null && days > 0 ? `${label} · ${days}d` : label;
}

export default async function ServicesPage() {
  const session = await getSession();
  const canDelete = !!session && isAdminEditor(session);

  const rawServices = await prisma.service.findMany({
    include: {
      client: true,
      items: { select: { plannedDate: true, actualDate: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const services = rawServices.map((s) => {
    const status = getServiceStatus(s.items, s.completedAt, s.reviewCompletedAt);
    return {
      ...s,
      status,
      statusDays: status === "delayed" ? getServiceDelayDays(s.items) : null,
      // Once completed (whether or not the customer review is still outstanding — see
      // review_not_completed in lib/service.ts), "Started" stops being the interesting date; how
      // long ago it was closed out is.
      startedLabel: s.completedAt
        ? `Completed ${formatDaysSince(s.completedAt)}`
        : `Started ${formatDaysSince(s.createdAt)}`,
    };
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {/* Teal is this list page's own identity color — distinct from Projects' indigo and
              from the service detail page's violet, so each of the three reads as its own
              place at a glance. */}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-inset ring-teal-200 dark:bg-teal-500/10 dark:text-teal-400 dark:ring-teal-500/25">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
              <path
                d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.6L4 17v3h3l5.9-5.9a3.5 3.5 0 0 0 4.6-4.6l-2.3 2.3-2-2 2.3-2.3Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h1 className="text-xl font-semibold text-fg">Services</h1>
        </div>
        <Link
          href="/services/new"
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-2"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} className="h-5 w-5 stroke-current">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          New service
        </Link>
      </div>

      {services.length === 0 ? (
        <p className="rounded-lg border border-dashed border-teal-500/40 bg-teal-500/5 py-10 text-center text-sm text-fg-muted dark:border-teal-500/30 dark:bg-teal-500/[0.04]">
          No services yet.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {services.map((service) => (
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
                {services.map((service) => (
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
