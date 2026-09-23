"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { OVERALL_STATUS_LABELS, DEPARTMENT_LABELS } from "@/lib/labels";
import { buildAllStepCodes } from "@/lib/step-template";
import { PHASE_PROGRESS_FILTER_OPTIONS } from "@/lib/project-filters";

const STEP_OPTIONS = buildAllStepCodes();
const SEARCH_DEBOUNCE_MS = 300;

export function ProjectFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    router.push(`/projects?${params.toString()}`);
  }

  // Debounced separately from setParam above — pushing a route change on every keystroke would
  // re-run the server query mid-word. Local state updates immediately so the input feels
  // responsive; the URL (and thus the Prisma query) only catches up after a short pause.
  const appliedQuery = searchParams.get("q") ?? "";
  const [prevAppliedQuery, setPrevAppliedQuery] = useState(appliedQuery);
  const [query, setQuery] = useState(appliedQuery);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (prevAppliedQuery !== appliedQuery) {
    setPrevAppliedQuery(appliedQuery);
    setQuery(appliedQuery);
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setParam("q", value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }

  // Unlike every other filter above, the install window doesn't apply on every change — typing a
  // "from" date would otherwise refetch before "to" is even set. Kept as local draft state,
  // pushed to the URL together by the Apply button. Reset during render (not an effect — the
  // React-recommended way to adjust state when a prop-like value changes, see "You Might Not
  // Need an Effect") whenever the URL changes from elsewhere, e.g. "Clear filters" or back/forward.
  const appliedInstallFrom = searchParams.get("installFrom") ?? "";
  const appliedInstallTo = searchParams.get("installTo") ?? "";
  const [prevApplied, setPrevApplied] = useState({ from: appliedInstallFrom, to: appliedInstallTo });
  const [installFrom, setInstallFrom] = useState(appliedInstallFrom);
  const [installTo, setInstallTo] = useState(appliedInstallTo);

  if (prevApplied.from !== appliedInstallFrom || prevApplied.to !== appliedInstallTo) {
    setPrevApplied({ from: appliedInstallFrom, to: appliedInstallTo });
    setInstallFrom(appliedInstallFrom);
    setInstallTo(appliedInstallTo);
  }

  function applyInstallWindow() {
    const params = new URLSearchParams(searchParams.toString());
    if (installFrom) params.set("installFrom", installFrom);
    else params.delete("installFrom");
    if (installTo) params.set("installTo", installTo);
    else params.delete("installTo");
    router.push(`/projects?${params.toString()}`);
  }

  const hasUnappliedChange = installFrom !== appliedInstallFrom || installTo !== appliedInstallTo;

  // Downloads exactly what's currently applied (not the unsaved draft above) — matches the
  // window the visible list itself is scoped to right now. Empty when no range is applied,
  // same as clearing the filter shows every project instead of none.
  const scheduleParams = new URLSearchParams();
  if (appliedInstallFrom) scheduleParams.set("installFrom", appliedInstallFrom);
  if (appliedInstallTo) scheduleParams.set("installTo", appliedInstallTo);
  const scheduleHref = `/api/projects/schedule${scheduleParams.size ? `?${scheduleParams.toString()}` : ""}`;

  const selectClass =
    "h-11 w-full rounded-lg border border-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:w-44";

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth={1.8}
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 stroke-current text-fg-subtle"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" strokeLinecap="round" />
        </svg>
        <input
          type="text"
          aria-label="Search projects by project or client name"
          placeholder="Search by project or client name…"
          className="h-11 w-full rounded-lg border border-edge bg-surface pl-9 pr-9 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
        />
        {query && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              if (searchTimeout.current) clearTimeout(searchTimeout.current);
              handleQueryChange("");
            }}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-fg-subtle hover:text-fg"
          >
            <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-4 w-4 stroke-current">
              <path d="m6 6 12 12M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center">
        <select
          aria-label="Filter by phase"
          className={selectClass}
          value={searchParams.get("phase") ?? ""}
          onChange={(e) => setParam("phase", e.target.value)}
        >
          <option value="">All phases</option>
          {PHASE_PROGRESS_FILTER_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          className={selectClass}
          value={searchParams.get("status") ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
        >
          <option value="">All statuses</option>
          {Object.entries(OVERALL_STATUS_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by department"
          className={selectClass}
          value={searchParams.get("department") ?? ""}
          onChange={(e) => setParam("department", e.target.value)}
        >
          <option value="">All departments</option>
          {Object.entries(DEPARTMENT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by current step"
          className={selectClass}
          value={searchParams.get("currentStep") ?? ""}
          onChange={(e) => setParam("currentStep", e.target.value)}
        >
          <option value="">All current steps</option>
          {STEP_OPTIONS.map(({ stepCode, stepName }) => (
            <option key={stepCode} value={stepCode}>
              {stepCode} · {stepName}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-edge p-3 sm:flex-row sm:items-center">
        <span className="text-xs font-medium text-fg-muted">Installation (3C2) planned window</span>
        <div className="flex items-center gap-2">
          <input
            type="date"
            aria-label="Installation (3C2) planned window from"
            className="h-11 w-full rounded-lg border border-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:w-36"
            value={installFrom}
            max={installTo || undefined}
            onChange={(e) => setInstallFrom(e.target.value)}
          />
          <span className="text-xs text-fg-subtle">to</span>
          <input
            type="date"
            aria-label="Installation (3C2) planned window to"
            className="h-11 w-full rounded-lg border border-edge bg-surface px-3 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:w-36"
            value={installTo}
            min={installFrom || undefined}
            onChange={(e) => setInstallTo(e.target.value)}
          />
        </div>
        <button
          type="button"
          onClick={applyInstallWindow}
          disabled={!hasUnappliedChange}
          className="flex h-11 items-center justify-center rounded-lg bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Apply
        </button>
        <a
          href={scheduleHref}
          className="flex h-11 items-center justify-center gap-1.5 rounded-lg border border-edge px-4 text-sm font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg"
        >
          <svg viewBox="0 0 24 24" fill="none" strokeWidth={1.8} className="h-4 w-4 stroke-current">
            <path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Download schedule
        </a>
      </div>
    </div>
  );
}
