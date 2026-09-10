import { redirect } from "next/navigation";
import { getSession, isAdminEditor } from "@/lib/auth";

// Gates the whole /projects tree (list, new, detail, edit) at once, rather than repeating this
// check in every page under it — same "admin/owner console, not a per-department work surface"
// reasoning as the detail page's own guard (which predates this layout and stays in place as
// defense in depth). Everyone else's actual work lives in /my-tasks.
export default async function ProjectsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !isAdminEditor(session)) {
    redirect("/my-tasks");
  }

  return children;
}
