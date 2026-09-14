import { redirect } from "next/navigation";
import { getSession, isAdminEditor } from "@/lib/auth";

// Gates the whole /contractors tree (list, new) at once — same reasoning as /clients/layout.tsx.
// Everyone else's actual work lives in /my-tasks.
export default async function ContractorsLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || !isAdminEditor(session)) {
    redirect("/my-tasks");
  }

  return children;
}
