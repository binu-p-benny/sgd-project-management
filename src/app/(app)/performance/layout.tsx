import { redirect } from "next/navigation";
import { getSession, isOwnerAdmin } from "@/lib/auth";

// Department performance / bonus scoring is the owner's call alone — not HR & Admin, who are a
// proxy editor for everyone else's work and would be scoring themselves. Same whole-subtree
// gate style as /projects' layout, just tightened to owner_admin only. Everyone else lands
// back on their own home.
export default async function PerformanceLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  if (!isOwnerAdmin(session)) redirect("/my-tasks");

  return children;
}
