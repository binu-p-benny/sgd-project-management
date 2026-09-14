import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { ServicesList } from "@/components/services/ServicesList";
import { getServiceStatus } from "@/lib/service";
import { isProcurementStageOverrun, daysBlocked } from "@/lib/overrun";

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
        <ServicesList services={services} canDelete={canDelete} />
      )}
    </div>
  );
}
