import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { getSession, isAdminEditor } from "@/lib/auth";
import { DeleteContractorButton } from "@/components/contractors/DeleteContractorButton";

export default async function ContractorsPage() {
  const session = await getSession();
  const canDelete = !!session && isAdminEditor(session);

  const contractors = await prisma.contractor.findMany({ orderBy: { name: "asc" } });

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          {/* Orange is this page's own identity color — distinct from Projects' indigo, the
              services list's teal, and Clients' cyan. */}
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/10 dark:text-orange-400 dark:ring-orange-500/25">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-5 w-5 stroke-current">
              <rect x="3.5" y="9" width="17" height="10" rx="1.5" />
              <path d="M8.5 9V6a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 6v3M3.5 13.5h17" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h1 className="text-xl font-semibold text-fg">Contractors</h1>
        </div>
        <Link
          href="/contractors/new"
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-2"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={2.2} className="h-5 w-5 stroke-current">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add contractor
        </Link>
      </div>

      {contractors.length === 0 ? (
        <p className="rounded-lg border border-dashed border-orange-500/40 bg-orange-500/5 py-10 text-center text-sm text-fg-muted dark:border-orange-500/30 dark:bg-orange-500/[0.04]">
          No contractors yet.
        </p>
      ) : (
        <>
          {/* Mobile: stacked cards */}
          <div className="flex flex-col gap-3 sm:hidden">
            {contractors.map((contractor) => (
              <div
                key={contractor.id}
                className="flex flex-col gap-2 rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 dark:border-orange-500/25 dark:bg-orange-500/[0.04]"
              >
                <span className="font-medium text-fg">{contractor.name}</span>
                <div className="text-sm text-fg-muted">{contractor.phone}</div>
                <div className="text-sm text-fg-muted">{contractor.address}</div>
                {canDelete && (
                  <div className="flex justify-end border-t border-edge pt-2">
                    <DeleteContractorButton contractorId={contractor.id} contractorName={contractor.name} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-x-auto rounded-xl border border-orange-500/30 bg-orange-500/5 dark:border-orange-500/25 dark:bg-orange-500/[0.04] sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-orange-500/10 text-[11px] uppercase tracking-wider text-fg-subtle dark:bg-orange-500/[0.08]">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Phone</th>
                  <th className="px-4 py-3 font-medium">Address</th>
                  {canDelete && <th className="px-4 py-3 font-medium text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-edge">
                {contractors.map((contractor) => (
                  <tr key={contractor.id} className="bg-surface">
                    <td className="px-4 py-3 font-medium text-fg">{contractor.name}</td>
                    <td className="px-4 py-3 text-fg-muted">{contractor.phone}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-fg-muted">{contractor.address}</td>
                    {canDelete && (
                      <td className="px-4 py-3 text-right">
                        <DeleteContractorButton contractorId={contractor.id} contractorName={contractor.name} />
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
