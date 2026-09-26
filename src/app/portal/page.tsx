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
 *
 * One continuous paper background from header to footer: the dark bands the page used to open
 * and close with are gone, so the project itself is the only thing competing for attention.
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
        <div className="mx-auto w-full max-w-5xl px-6 pb-2 pt-12 sm:px-8 sm:pt-16">
          <p className="text-[11px] uppercase tracking-[0.2em] text-fg-subtle">Welcome</p>
          <h1 className="mt-3 text-[32px] leading-[1.1] text-fg sm:text-[44px]">{firstName}</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-fg-muted">
            {projects.length === 0
              ? "We don't have a project on this number yet. Once work begins, its progress will appear here."
              : projects.length === 1
                ? "Here's where your project stands today."
                : `Here's where your ${projects.length} projects stand today — the most recent one first.`}
          </p>
        </div>

        {projects.length === 0 ? (
          <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-8">
            <p className="text-sm text-fg-muted">
              If you believe this is a mistake, call the SGD office and we&apos;ll check the phone
              number on your file.
            </p>
          </div>
        ) : (
          <PortalProgress projects={projects} />
        )}
      </main>

      <footer className="mt-auto border-t border-edge">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-6 py-8 sm:px-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-fg-subtle">SGD Group of Companies</p>
          <p className="text-xs text-fg-muted">
            Questions about your project? Call the office and quote your project name.
          </p>
        </div>
      </footer>
    </>
  );
}
