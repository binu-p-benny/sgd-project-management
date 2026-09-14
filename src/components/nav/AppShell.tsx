"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { DEPARTMENT_LABELS } from "@/lib/labels";
import { ThemeToggle } from "./ThemeToggle";
import { NotificationBell } from "./NotificationBell";
import { Spinner } from "@/components/ui/Spinner";
import type { Department } from "@prisma/client";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const HOME_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <path d="M4 11.5 12 4l8 7.5" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M6 10v9a1 1 0 0 0 1 1h3v-5.5h4V20h3a1 1 0 0 0 1-1v-9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PROJECTS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <rect x="4" y="5" width="16" height="15" rx="1.5" />
    <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
  </svg>
);

const SERVICES_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <path
      d="M14.5 6.5a3.5 3.5 0 0 0-4.6 4.6L4 17v3h3l5.9-5.9a3.5 3.5 0 0 0 4.6-4.6l-2.3 2.3-2-2 2.3-2.3Z"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CLIENTS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <circle cx="12" cy="8" r="3.2" />
    <path d="M5 20c0-3.6 3.1-6.5 7-6.5s7 2.9 7 6.5" strokeLinecap="round" />
  </svg>
);

const CONTRACTORS_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <rect x="3.5" y="9" width="17" height="10" rx="1.5" />
    <path d="M8.5 9V6a1.5 1.5 0 0 1 1.5-1.5h4A1.5 1.5 0 0 1 15.5 6v3M3.5 13.5h17" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const DASHBOARD_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <rect x="4" y="4" width="7" height="9" rx="1" />
    <rect x="13" y="4" width="7" height="5" rx="1" />
    <rect x="13" y="11" width="7" height="9" rx="1" />
    <rect x="4" y="15" width="7" height="5" rx="1" />
  </svg>
);

const ADMIN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <path d="M12 3.5 18.5 6v5.5c0 4.5-2.8 7.7-6.5 9-3.7-1.3-6.5-4.5-6.5-9V6L12 3.5Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.3 12.2l1.9 1.9 3.5-3.9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PERFORMANCE_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <path d="M7 5h10v3a5 5 0 0 1-10 0V5Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M7 6H4.5a2 2 0 0 0 2.5 3.6M17 6h2.5A2 2 0 0 1 17 9.6M9.5 19h5M12 14v5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const LOGOUT_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <path d="M9 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M14 8l4 4-4 4M18 12H9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Solid icon chip — same visual weight as the logo mark, so it stays legible collapsed or expanded. */
export function IconChip({ children, active }: { children: React.ReactNode; active: boolean }) {
  return (
    <span
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg p-2 transition-colors ${
        active ? "bg-accent text-white shadow-[var(--shadow-accent)]" : "bg-overlay text-fg-muted group-hover/item:bg-overlay-2 group-hover/item:text-fg"
      }`}
    >
      {children}
    </span>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function navItemsFor(department: Department): NavItem[] {
  const primary: NavItem =
    department === "owner_admin"
      ? { href: "/dashboard", label: "Dashboard", icon: DASHBOARD_ICON }
      : { href: "/my-tasks", label: "My Tasks", icon: HOME_ICON };

  const items: NavItem[] = [primary];

  // HR & Admin proxy-edits any department's steps/procurement/payment on their behalf — same
  // pairing /clients', /contractors', /projects' and /services' own layout.tsx gate on, so
  // these links only ever appear for someone who can actually get past them.
  const isAdmin = department === "owner_admin" || department === "hr_admin";
  if (isAdmin) {
    items.push(
      { href: "/clients", label: "Clients", icon: CLIENTS_ICON },
      { href: "/contractors", label: "Contractors", icon: CONTRACTORS_ICON },
      { href: "/projects", label: "Projects", icon: PROJECTS_ICON },
      { href: "/services", label: "Services", icon: SERVICES_ICON },
      { href: "/admin", label: "Admin", icon: ADMIN_ICON }
    );
  }

  // Department scoring / bonus is the owner's alone — HR & Admin would be grading themselves
  // (see /performance's own layout.tsx gate).
  if (department === "owner_admin") {
    items.push({ href: "/performance", label: "Performance", icon: PERFORMANCE_ICON });
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
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Desktop left sidebar — icon rail that expands to icon+label on hover */}
      <aside className="group sticky top-0 hidden h-screen w-[72px] shrink-0 flex-col overflow-hidden border-r border-edge bg-surface/90 backdrop-blur-md transition-[width] duration-200 ease-in-out hover:w-60 sm:flex">
        <div className="flex h-16 shrink-0 items-center gap-3 px-[15px]">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-xs font-bold text-white shadow-[var(--shadow-accent)]">
            S
          </span>
          <span className="shrink-0">
            <NotificationBell />
          </span>
          <span className="whitespace-nowrap text-base font-semibold tracking-tight text-fg opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            SGD Monitoring
          </span>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-hidden px-3 py-2">
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group/item flex items-center gap-3 rounded-lg py-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
              >
                <IconChip active={active}>{item.icon}</IconChip>
                <span className={`whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 ${active ? "text-fg" : ""}`}>
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="shrink-0 border-t border-edge p-3">
          <div className="flex items-center gap-3 overflow-hidden px-0.5 py-1">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-xs font-semibold text-fg">
              {initials(session.name)}
            </span>
            <div className="min-w-0 whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              <div className="truncate text-sm font-medium text-fg">{session.name}</div>
              <div className="truncate text-xs text-fg-muted">{DEPARTMENT_LABELS[session.department]}</div>
            </div>
          </div>
          <ThemeToggle />
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="group/item mt-1 flex w-full items-center gap-3 rounded-lg py-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-60"
          >
            <IconChip active={false}>{loggingOut ? <Spinner className="h-4 w-4" /> : LOGOUT_ICON}</IconChip>
            <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100">
              {loggingOut ? "Logging out…" : "Log out"}
            </span>
          </button>
        </div>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col overflow-x-hidden">
        {/* Mobile top bar */}
        <header className="flex items-center justify-between border-b border-edge bg-surface/70 px-4 py-3 backdrop-blur-md sm:hidden">
          <span className="flex items-center gap-2.5 text-base font-semibold tracking-tight text-fg">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-accent-2 text-xs font-bold text-white shadow-[var(--shadow-accent)]">
              S
            </span>
            SGD Monitoring
          </span>
          <div className="flex items-center gap-3">
            <NotificationBell />
            <ThemeToggle variant="iconOnly" />
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="flex items-center gap-1.5 text-sm font-medium text-fg-muted disabled:opacity-60"
            >
              {loggingOut && <Spinner className="h-3.5 w-3.5" />}
              Log out
            </button>
          </div>
        </header>

        <main className="w-full flex-1 px-4 pb-20 pt-4 sm:px-6 sm:pb-8 sm:pt-6">
          {children}
        </main>

        {/* Mobile bottom tab bar */}
        <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-edge bg-surface/90 backdrop-blur-md sm:hidden">
          {items.map((item) => {
            const active = pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className="flex flex-1 flex-col items-center gap-1 py-2.5">
                <span className={`h-6 w-6 ${active ? "text-fg" : "text-fg-subtle"}`}>{item.icon}</span>
                <span className={`text-xs font-medium ${active ? "text-fg" : "text-fg-subtle"}`}>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
