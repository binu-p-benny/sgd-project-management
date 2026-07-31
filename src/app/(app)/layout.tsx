import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { AppShell } from "@/components/nav/AppShell";

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
