import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { DeleteServiceButton } from "@/components/services/DeleteServiceButton";
import { getServiceStatus } from "@/lib/service";
import { SERVICE_STATUS_LABELS, SERVICE_STATUS_COLORS } from "@/lib/labels";

function formatINR(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export default async function ServicesPage() {
  const session = await getSession();
  const canDelete = !!session && isAdminEditor(session);

  const rawServices = await prisma.service.findMany({
    include: { items: { select: { plannedDate: true, actualDate: true, isPassFail: true, qcPassed: true } } },
    orderBy: { createdAt: "desc" },
  });

  const services = rawServices.map((s) => ({ ...s, status: getServiceStatus(s.items) }));

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
                      {SERVICE_STATUS_LABELS[service.status]}
                    </span>
                  </div>
                  <div className="text-sm text-fg-muted">{service.clientName}</div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-fg-muted">
                      {service.items.filter((i) => i.actualDate !== null).length} / {service.items.length} done
                    </span>
                    <span className="font-mono tabular-nums text-fg-muted">{formatINR(Number(service.finalCost))}</span>
                  </div>
                </Link>
                {canDelete && (
                  <div className="flex justify-end border-t border-edge pt-2">
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
                  <th className="px-4 py-3 font-medium">Work items</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Final cost</th>
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
                    <td className="px-4 py-3 text-fg-muted">{service.clientName}</td>
                    <td className="px-4 py-3 text-fg-muted">
                      {service.items.filter((i) => i.actualDate !== null).length} / {service.items.length} done
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${SERVICE_STATUS_COLORS[service.status]}`}
                      >
                        {SERVICE_STATUS_LABELS[service.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-fg-muted">
                      {formatINR(Number(service.finalCost))}
                    </td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteServiceButton serviceId={service.id} serviceTitle={service.title} />
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
