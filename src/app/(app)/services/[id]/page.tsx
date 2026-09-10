import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { ServiceTracker } from "@/components/services/ServiceTracker";
import { DeleteServiceButton } from "@/components/services/DeleteServiceButton";
import { ServiceReviewCard } from "@/components/services/ServiceReviewCard";
import { isProcurementStageOverrun } from "@/lib/overrun";
import { getServiceStatus, getServiceReviewPlannedDate } from "@/lib/service";
import { SERVICE_STATUS_LABELS, SERVICE_STATUS_COLORS } from "@/lib/labels";

export default async function ServiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  const service = await prisma.service.findUnique({
    where: { id },
    include: { client: true, items: { orderBy: { createdAt: "asc" } } },
  });
  if (!service) notFound();

  const status = getServiceStatus(service.items, service.completedAt, service.reviewCompletedAt);
  // Same "any signed-in user can add/complete a row" idea as ProcurementActionItem's own rows —
  // a service item's department is chosen per-row, not owned by a single team the way a
  // procurement item's fixed stages are, so there's no single department to gate editing behind.
  const canEdit = !!session;
  const canDelete = !!session && (session.department === "owner_admin" || session.department === "hr_admin");
  // The customer review is an admin-only proxy edit, same as the Project's own phase reviews.
  const canEditReview = canDelete;

  return (
    <div className="flex flex-col gap-6">
      {/* Violet is this detail page's own identity color — distinct from Projects' indigo and
          from the services list page's teal, so each of the three reads as its own place at a
          glance. */}
      <div className="flex flex-col gap-3 rounded-xl border border-edge border-t-4 border-t-violet-500 bg-gradient-to-br from-violet-50 to-70% to-surface p-5 shadow-[var(--shadow-sm)] dark:from-violet-500/10 sm:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700 ring-1 ring-inset ring-violet-200 dark:bg-violet-500/10 dark:text-violet-400 dark:ring-violet-500/25">
              <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
                <path
                  d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.6L4 17v3h3l5.9-5.9a3.5 3.5 0 0 0 4.6-4.6l-2.3 2.3-2-2 2.3-2.3Z"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <div>
              <h1 className="text-xl font-semibold text-fg">{service.title}</h1>
              <p className="text-sm text-fg-muted">
                {service.client.name} · {service.client.phone}
              </p>
              <p className="text-sm text-fg-muted">{service.client.address}</p>
              {service.description && <p className="mt-1 text-sm text-fg-muted">{service.description}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`w-fit rounded-full px-2.5 py-1 text-xs font-medium ${SERVICE_STATUS_COLORS[status]}`}>
              {SERVICE_STATUS_LABELS[status]}
            </span>
            {canDelete && <DeleteServiceButton serviceId={service.id} serviceTitle={service.title} />}
          </div>
        </div>

        <div className="border-t border-edge pt-4 text-sm">
          <div className="text-fg-subtle">Work items</div>
          <div className="font-medium text-fg">
            {service.items.filter((i) => i.actualDate !== null).length} / {service.items.length} done
          </div>
        </div>
      </div>

      <ServiceTracker
        serviceId={service.id}
        canEdit={canEdit}
        items={service.items.map((item) => ({
          id: item.id,
          taskLabel: item.taskLabel,
          department: item.department,
          isPassFail: item.isPassFail,
          qcPassed: item.qcPassed,
          plannedDate: item.plannedDate.toISOString(),
          actualDate: item.actualDate?.toISOString() ?? null,
          note: item.note,
          overrun: isProcurementStageOverrun(item.plannedDate, item.actualDate),
        }))}
      />

      {service.completedAt && (
        <ServiceReviewCard
          serviceId={service.id}
          plannedDate={getServiceReviewPlannedDate(service.completedAt).toISOString()}
          reviewCompletedAt={service.reviewCompletedAt?.toISOString() ?? null}
          reviewNote={service.reviewNote}
          canEdit={canEditReview}
        />
      )}
    </div>
  );
}
