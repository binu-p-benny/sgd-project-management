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
 * One continuous paper background, and the greeting reduced to a single line: what a client
 * opens this page for is the timeline, so the first screen is spent on that rather than on a
 * welcome banner.
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
        {projects.length === 0 ? (
          <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:px-8">
            <p className="text-[11px] uppercase tracking-[0.2em] text-fg-subtle">Welcome, {firstName}</p>
            <h1 className="mt-3 text-[26px] leading-[1.15] text-fg sm:text-[32px]">
              We don&apos;t have a project on this number yet
            </h1>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-fg-muted">
              Once work begins, its progress will appear here. If you believe this is a mistake, call
              the SGD office and we&apos;ll check the phone number on your file.
            </p>
          </div>
        ) : (
          <PortalProgress projects={projects} firstName={firstName} />
        )}
      </main>

      <footer className="mt-auto border-t border-edge">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-1 px-6 py-6 sm:px-8">
          <p className="text-[11px] uppercase tracking-[0.2em] text-fg-subtle">SGD Group of Companies</p>
          <p className="text-xs text-fg-muted">
            Questions about your project? Call the office and quote your project name.
          </p>
        </div>
      </footer>
    </>
  );
}
