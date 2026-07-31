import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell } from "@/components/nav/AppShell";

// Every route in this segment reads the session cookie to gate access, so none of them
// are ever meaningfully static — force dynamic rendering here instead of leaving it to
// per-page dynamic-API detection. Without this, cookies() throws Next's internal
// "bail out to dynamic" signal during build-time prerendering; the try/catch below would
// catch that framework-internal throw and convert it into a real Error, which aborts the
// build instead of the framework's normal (non-fatal) bailout.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let session;
  try {
    session = await getSession();
  } catch (error) {
    console.error("[app-layout] failed to resolve session", error);
    throw new Error("Unable to verify your session. Please try again shortly.");
  }

  if (!session) {
    redirect("/login");
  }

  return (
    <AppShell session={{ name: session.name, department: session.department }}>
      {children}
    </AppShell>
  );
}
