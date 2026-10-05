import { redirect } from "next/navigation";
import { getSession, isAdminEditor } from "@/lib/auth";

// Gates the whole /common-tasks tree (list, new) at once — same reasoning as /contractors/layout.tsx.
// Everyone else's actual work (marking one complete) lives in /my-tasks.
export default async function CommonTasksLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !isAdminEditor(session)) {
    redirect("/my-tasks");
  }

  return children;
}
