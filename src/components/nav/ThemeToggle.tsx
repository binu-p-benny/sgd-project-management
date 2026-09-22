"use client";

import { useEffect, useState } from "react";
import { IconChip } from "./AppShell";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem("theme", theme);
}

const SUN_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <circle cx="12" cy="12" r="4.5" />
    <path
      d="M12 2.5v2.5M12 19v2.5M4.5 12H2M22 12h-2.5M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"
      strokeLinecap="round"
    />
  </svg>
);

const MOON_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-full w-full stroke-current">
    <path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Nav-row toggle matching the sidebar's IconChip items — undefined until mount to avoid SSR/client mismatch. */
export function ThemeToggle({ variant = "row" }: { variant?: "row" | "iconOnly" }) {
  const [theme, setTheme] = useState<Theme | undefined>(undefined);

  useEffect(() => {
    setTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  const icon = theme === "dark" ? SUN_ICON : MOON_ICON;
  const label = theme === "dark" ? "Light mode" : "Dark mode";

  if (variant === "iconOnly") {
    return (
      <button type="button" onClick={toggle} aria-label={label} className="flex h-7 w-7 items-center justify-center text-fg-muted">
        <span className="h-5 w-5">{icon}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className="group/item mt-1 flex w-full items-center gap-3 rounded-lg py-1 text-sm font-medium text-fg-muted transition-colors hover:text-fg"
    >
      <IconChip active={false}>{icon}</IconChip>
      <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-[:hover]:opacity-100">{label}</span>
    </button>
  );
}
