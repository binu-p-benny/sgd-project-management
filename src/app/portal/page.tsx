import { redirect } from "next/navigation";
import { getClientSession } from "@/lib/client-auth";
import { getPortalProjects } from "@/lib/client-portal";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { PortalSignOut } from "@/components/portal/PortalSignOut";
import { PortalProgress } from "@/components/portal/PortalProgress";

/**
 * The client's own progress page. Projects are read from the client ids on the session and
 * nothing else — there is no project id in the URL to tamper with, and no route under /portal
 * accepts one.
 */
export default async function PortalPage() {
  const session = await getClientSession();
  // The proxy already redirects an unauthenticated visitor; this is the belt-and-braces for a
  // direct render (and what narrows the type).
  if (!session) redirect("/portal/login");

  const projects = await getPortalProjects(session.clientIds);
  const firstName = session.name.trim().split(/\s+/)[0];

  return (
    <>
      <PortalHeader>
        <PortalSignOut />
      </PortalHeader>

      <main className="flex-1">
        <div className="portal-ink">
          <div className="mx-auto w-full max-w-5xl px-6 pb-12 pt-10 sm:px-8 sm:pb-16 sm:pt-14">
            <p className="text-[11px] uppercase tracking-[0.2em] text-[rgba(245,244,239,0.5)]">Welcome</p>
            <h1 className="mt-3 text-[32px] leading-[1.1] text-[#eae8e3] sm:text-[44px]">{firstName}</h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-[rgba(245,244,239,0.6)]">
              {projects.length === 0
                ? "We don't have a project on this number yet. Once work begins, its progress will appear here."
                : projects.length === 1
                  ? "Here's where your project stands today."
                  : `Here's where your ${projects.length} projects stand today — the most recent one first.`}
            </p>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:px-8">
            <p className="text-sm text-fg-muted">
              If you believe this is a mistake, call the SGD office and we&apos;ll check the phone
              number on your file.
            </p>
          </div>
        ) : (
          <PortalProgress projects={projects} />
        )}
      </main>

      <footer className="portal-ink mt-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-6 py-8 sm:px-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-[rgba(245,244,239,0.5)]">
            SGD Group of Companies
          </p>
          <p className="text-xs text-[rgba(245,244,239,0.45)]">
            Questions about your project? Call the office and quote your project name.
          </p>
        </div>
      </footer>
    </>
  );
}
