"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Spinner } from "@/components/ui/Spinner";

interface NotificationRow {
  id: string;
  message: string;
  projectId: string | null;
  phaseStepId: string | null;
  readAt: string | null;
  createdAt: string;
}

const POLL_MS = 60_000;

/**
 * Relative age, worded the way someone reading their own history would say it out loud
 * ("a minute ago", not "1m ago"). Anything past a week is a plain date instead — "63 days
 * ago" reads as noise where "12 Sep 2026" is something you can match against a project.
 */
function timeAgo(iso: string): string {
  const then = new Date(iso);
  const minutes = Math.floor((Date.now() - then.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "a minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "an hour ago";
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric" }).format(then);
}

/** Full timestamp for the row's title attribute — the exact moment behind "2 hours ago". */
function fullTimestamp(iso: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
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
  page,
  totalPages,
  totalCount,
  loading,
  marking,
  onMarkAllRead,
  onMarkRead,
  onPageChange,
}: {
  anchorRect: DOMRect;
  notifications: NotificationRow[];
  unreadCount: number;
  page: number;
  totalPages: number;
  totalCount: number;
  loading: boolean;
  marking: boolean;
  onMarkAllRead: () => void;
  onMarkRead: (id: string) => void;
  onPageChange: (page: number) => void;
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
        <span className="flex items-baseline gap-1.5 text-sm font-semibold text-fg">
          Notifications
          {totalCount > 0 && (
            <span className="font-mono text-[10px] font-normal tabular-nums text-fg-subtle">{totalCount} total</span>
          )}
        </span>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={onMarkAllRead}
            disabled={marking}
            className="flex items-center gap-1.5 text-xs font-medium text-accent hover:underline disabled:opacity-50"
          >
            {marking && <Spinner className="h-3 w-3" />}
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
                <span className="text-[10px] text-fg-subtle" title={fullTimestamp(n.createdAt)}>
                  {timeAgo(n.createdAt)}
                </span>
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

      {/* History pager — same shape as the dashboard widgets' footer, five rows to a page. */}
      {totalCount > 0 && (
        <div className="flex shrink-0 items-center justify-between border-t border-edge px-3 py-2">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={loading || page <= 1}
            className="rounded-lg border border-edge px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-fg-muted">
            {loading && <Spinner className="h-3 w-3" />}
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={loading || page >= totalPages}
            className="rounded-lg border border-edge px-2 py-1 text-[11px] font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </div>,
    document.body
  );
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [marking, setMarking] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  // The background poll has to refresh whatever page is on screen, but `load` must not be
  // re-created on every page change or the poll interval would restart with it.
  const pageRef = useRef(1);

  const load = useCallback(async (nextPage?: number) => {
    const target = nextPage ?? pageRef.current;
    if (nextPage !== undefined) setLoading(true);
    try {
      const res = await fetch(`/api/notifications?page=${target}`);
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
      setTotalCount(data.totalCount ?? 0);
      setTotalPages(data.totalPages ?? 1);
      // The server clamps the page to what actually exists, so trust its answer rather than
      // the number we asked for.
      const settled = data.page ?? 1;
      pageRef.current = settled;
      setPage(settled);
    } catch {
      // silent — the badge just stays at its last known value until the next poll
    } finally {
      if (nextPage !== undefined) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(() => load(), POLL_MS);
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
      // Every open starts at the newest page — reopening the bell to find yourself parked on
      // page 4 from last time would hide whatever just came in.
      if (pageRef.current !== 1) load(1);
    }
    setOpen((v) => !v);
  }

  function goToPage(next: number) {
    if (loading || next < 1 || next > totalPages || next === page) return;
    load(next);
  }

  async function markRead(id?: string) {
    // Only the explicit "Mark all read" click gets a visible busy state — an individual
    // notification's own click either navigates away immediately (it has a project to go to)
    // or is too small a target to usefully show one.
    if (!id) setMarking(true);
    try {
      await fetch("/api/notifications/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(id ? { id } : {}),
      });
      await load();
    } catch {
      // no-op — next poll will reconcile
    } finally {
      if (!id) setMarking(false);
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
          page={page}
          totalPages={totalPages}
          totalCount={totalCount}
          loading={loading}
          marking={marking}
          onMarkAllRead={() => markRead()}
          onMarkRead={(id) => markRead(id)}
          onPageChange={goToPage}
        />
      )}
    </>
  );
}
