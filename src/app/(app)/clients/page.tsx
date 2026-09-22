import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { DeleteClientButton } from "@/components/clients/DeleteClientButton";

export default async function ClientsPage() {
  const session = await getSession();
  const canDelete = !!session && isAdminEditor(session);

  const clients = await prisma.client.findMany({
    include: { _count: { select: { projects: true, services: true } } },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {/* Cyan is this page's own identity color — distinct from Projects' indigo, the
              services list's teal, and the service detail page's violet. */}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-50 text-cyan-700 ring-1 ring-inset ring-cyan-200 dark:bg-cyan-500/10 dark:text-cyan-400 dark:ring-cyan-500/25">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" strokeLinecap="round" />
            </svg>
          </span>
          <h1 className="text-xl font-semibold text-fg">Clients</h1>
        </div>
        <Link
          href="/clients/new"
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-2"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} className="h-5 w-5 stroke-current">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add client
        </Link>
      </div>

      {clients.length === 0 ? (
        <p className="rounded-lg border border-dashed border-cyan-500/40 bg-cyan-500/5 py-10 text-center text-sm text-fg-muted dark:border-cyan-500/30 dark:bg-cyan-500/[0.04]">
          No clients yet.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {clients.map((client) => (
              <div
                key={client.id}
                className="flex flex-col gap-2 rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4 dark:border-cyan-500/25 dark:bg-cyan-500/[0.04]"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-fg">{client.name}</span>
                  <span className="shrink-0 text-xs text-fg-subtle">
                    {client._count.projects} project{client._count.projects === 1 ? "" : "s"} ·{" "}
                    {client._count.services} service{client._count.services === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="truncate font-mono text-[11px] text-fg-subtle" title={client.id}>
                  {client.id}
                </div>
                <div className="text-sm text-fg-muted">{client.phone}</div>
                <div className="text-sm text-fg-muted">{client.address}</div>
                {canDelete && (
                  <div className="flex justify-end border-t border-edge pt-2">
                    <DeleteClientButton clientId={client.id} clientName={client.name} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-cyan-500/30 bg-cyan-500/5 dark:border-cyan-500/25 dark:bg-cyan-500/[0.04] sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-cyan-500/10 text-[11px] uppercase tracking-wider text-fg-subtle dark:bg-cyan-500/[0.08]">
                <tr>
                  <th className="px-4 py-3 font-medium">ID</th>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Address</th>
                  <th className="px-4 py-3 font-medium">Projects</th>
                  <th className="px-4 py-3 font-medium">Services</th>
                  {canDelete && <th className="px-4 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {clients.map((client) => (
                  <tr key={client.id} className="bg-surface">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-fg-subtle" title={client.id}>
                      {client.id}
                    </td>
                    <td className="px-4 py-3 font-medium text-fg">{client.name}</td>
                    <td className="px-4 py-3 text-fg-muted">{client.phone}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-fg-muted">{client.address}</td>
                    <td className="px-4 py-3 text-fg-muted">{client._count.projects}</td>
                    <td className="px-4 py-3 text-fg-muted">{client._count.services}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteClientButton clientId={client.id} clientName={client.name} />
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
