"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DEPARTMENT_LABELS } from "@/lib/labels";
import type { Department } from "@prisma/client";

interface NavItem {
  href: string;
  label: string;
  icon: (active: boolean) => React.ReactNode;
}

function iconClass(active: boolean) {
  return active ? "stroke-fg" : "stroke-fg-subtle";
}

const HOME_ICON = (active: boolean) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className={`h-6 w-6 ${iconClass(active)}`}>
    <path d="M4 11.5 12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 10v9a1 1 0 0 0 1 1h3v-5.5h4V20h3a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PROJECTS_ICON = (active: boolean) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className={`h-6 w-6 ${iconClass(active)}`}>
    <rect x="4" y="5" width="16" height="15" rx="1.5" />
    <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
  </svg>
);

const DASHBOARD_ICON = (active: boolean) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className={`h-6 w-6 ${iconClass(active)}`}>
    <rect x="4" y="4" width="7" height="9" rx="1" />
    <rect x="13" y="4" width="7" height="5" rx="1" />
    <rect x="13" y="11" width="7" height="9" rx="1" />
    <rect x="4" y="15" width="7" height="5" rx="1" />
  </svg>
);

const ADMIN_ICON = (active: boolean) => (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className={`h-6 w-6 ${iconClass(active)}`}>
    <path d="M12 3.5 18.5 6v5.5c0 4.5-2.8 7.7-6.5 9-3.7-1.3-6.5-4.5-6.5-9V6L12 3.5Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.3 12.2l1.9 1.9 3.5-3.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function navItemsFor(department: Department): NavItem[] {
  const primary: NavItem =
    department === "owner_admin"
      ? { href: "/dashboard", label: "Dashboard", icon: DASHBOARD_ICON }
      : { href: "/my-tasks", label: "My Tasks", icon: HOME_ICON };

  const items: NavItem[] = [primary, { href: "/projects", label: "Projects", icon: PROJECTS_ICON }];

  // HR & Admin proxy-edits any department's steps/procurement/payment on their behalf.
  if (department === "owner_admin" || department === "hr_admin") {
    items.push({ href: "/admin", label: "Admin", icon: ADMIN_ICON });
  }

  return items;
}

export function AppShell({
  session,
  children,
}: {
  session: { name: string; department: Department };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const items = navItemsFor(session.department);

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* Desktop top nav */}
      <header className="hidden border-b border-edge bg-surface/80 backdrop-blur-sm sm:block">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-8">
            <span className="flex items-center gap-2 text-base font-semibold text-fg">
              <span className="h-2 w-2 rounded-full bg-accent" />
              SGD Monitoring
            </span>
            <nav className="flex items-center gap-1">
              {items.map((item) => {
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                      active ? "bg-white/[0.06] text-fg" : "text-fg-muted hover:bg-white/[0.04] hover:text-fg"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-medium text-fg">{session.name}</div>
              <div className="text-xs text-fg-muted">{DEPARTMENT_LABELS[session.department]}</div>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-edge px-3 py-2 text-sm font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-white/[0.04] hover:text-fg"
            >
              Log out
            </button>
          </div>
        </div>
      </header>

      {/* Mobile top bar */}
      <header className="flex items-center justify-between border-b border-edge bg-surface/80 px-4 py-3 backdrop-blur-sm sm:hidden">
        <span className="flex items-center gap-2 text-base font-semibold text-fg">
          <span className="h-2 w-2 rounded-full bg-accent" />
          SGD Monitoring
        </span>
        <button onClick={handleLogout} className="text-sm font-medium text-fg-muted">
          Log out
        </button>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-20 pt-4 sm:px-6 sm:pb-8 sm:pt-6">
        {children}
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-edge bg-surface/95 backdrop-blur-sm sm:hidden">
        {items.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link key={item.href} href={item.href} className="flex flex-1 flex-col items-center gap-1 py-2.5">
              {item.icon(active)}
              <span className={`text-xs font-medium ${active ? "text-fg" : "text-fg-subtle"}`}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
