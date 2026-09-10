import { redirect } from "next/navigation";
import { getSession, isAdminEditor } from "@/lib/auth";

// Gates the whole /services tree (list, new, detail) at once — same reasoning as
// /projects/layout.tsx. Everyone else's actual work lives in /my-tasks.
export default async function ServicesLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !isAdminEditor(session)) {
    redirect("/my-tasks");
  }

  return children;
}
