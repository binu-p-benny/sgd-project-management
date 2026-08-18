"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";

interface NotificationRow {
  id: string;
  message: string;
  projectId: string | null;
  phaseStepId: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 60_000;

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const BELL_ICON = (
  <svg viewBox="0 0 24 24" fill="none" strokeWidth={2} className="h-5 w-5 stroke-current">
    <path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M10 19a2 2 0 0 0 4 0" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * The dropdown panel is portaled to document.body rather than rendered inline: this
 * component sits inside AppShell's hover-expanding sidebar, which relies on
 * overflow-hidden to clip its width-transition animation — a same-tree absolutely
 * positioned panel would get clipped by that too. Position is computed from the
 * trigger button's own bounding rect instead.
 */
function DropdownPanel({
  anchorRect,
  notifications,
  unreadCount,
  onMarkAllRead,
  onMarkRead,
}: {
  anchorRect: DOMRect;
  notifications: NotificationRow[];
  unreadCount: number;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
}) {
  const panelWidth = 320;
  const left = Math.min(anchorRect.right - panelWidth, window.innerWidth - panelWidth - 8);

  return createPortal(
    <div
      data-notification-panel
      style={{ position: "fixed", top: anchorRect.bottom + 8, left: Math.max(left, 8), width: panelWidth }}
      className="z-50 flex max-h-96 flex-col overflow-hidden rounded-xl border border-edge bg-surface shadow-[var(--shadow-sm)]"
    >
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="text-sm font-semibold text-fg">Notifications</span>
        {unreadCount > 0 && (
          <button type="button" onClick={onMarkAllRead} className="text-xs font-medium text-accent hover:underline">
            Mark all read
          </button>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {notifications.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-muted">No notifications yet</p>
        ) : (
          notifications.map((n) => {
            const unread = !n.readAt;
            const content = (
              <div
                className={`flex flex-col gap-0.5 border-b border-edge px-3 py-2.5 text-xs last:border-b-0 ${
                  unread ? "bg-accent-soft/40" : ""
                }`}
              >
                <span className={unread ? "font-medium text-fg" : "text-fg-muted"}>{n.message}</span>
                <span className="text-[10px] text-fg-subtle">{timeAgo(n.createdAt)}</span>
              </div>
            );
            return n.projectId ? (
              <Link
                key={n.id}
                href={`/projects/${n.projectId}`}
                onClick={() => unread && onMarkRead(n.id)}
                className="block hover:bg-overlay"
              >
                {content}
              </Link>
            ) : (
              <div key={n.id} onClick={() => unread && onMarkRead(n.id)} className="cursor-pointer hover:bg-overlay">
                {content}
              </div>
            );
          })
        )}
      </div>
    </div>,
    document.body
  );
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications");
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } catch {
      // silent — the badge just stays at its last known value until the next poll
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      // The portaled panel isn't inside buttonRef — click-outside closes on anything
      // that isn't the trigger button or inside the panel itself.
      if (!(target instanceof Element) || !target.closest("[data-notification-panel]")) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function toggle() {
    if (!open && buttonRef.current) {
      setAnchorRect(buttonRef.current.getBoundingClientRect());
    }
    setOpen((v) => !v);
  }

  async function markRead(id?: string) {
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
      await load();
    } catch {
      // no-op — next poll will reconcile
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label="Notifications"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-fg-muted transition-colors hover:text-fg"
      >
        {BELL_ICON}
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && anchorRect && (
        <DropdownPanel
          anchorRect={anchorRect}
          notifications={notifications}
          unreadCount={unreadCount}
          onMarkAllRead={() => markRead()}
          onMarkRead={(id) => markRead(id)}
        />
      )}
    </>
  );
}
