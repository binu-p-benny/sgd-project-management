"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/Spinner";
import type { ProjectPhase } from "@prisma/client";

type TargetPhase = "phase_2" | "phase_3";

const TARGET_LABEL: Record<TargetPhase, string> = { phase_2: "Phase 2 · Procurement", phase_3: "Phase 3 · Installation" };
const TARGET_SUMMARY: Record<TargetPhase, string> = {
  phase_2: "Marks 1A–1D (Onboarding) completed.",
  phase_3:
    "Marks 1A–1D and every procurement item's stages (requirement, quote, payment, order, arrival, QC) completed. The final site measurement (2D2) is left open — that visit still needs to happen for real.",
};

function todayInputValue(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Owner-only escape hatch for a project that's already live in the real world past Phase 1 (or
 * Phase 2) by the time it's entered here — see POST /api/projects/[id]/skip-phase and skipToPhase
 * in step-actions.ts for what this actually bulk-completes. Not shown once there's nothing left
 * to skip to (Phase 3 or completed) — the whole point is resuming live tracking from wherever the
 * project actually is, so it never touches Phase 3 itself.
 */
export function SkipPhaseButton({ projectId, currentPhase }: { projectId: string; currentPhase: ProjectPhase }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<TargetPhase>(currentPhase === "phase_1" ? "phase_2" : "phase_3");
  const [asOfDate, setAsOfDate] = useState(todayInputValue());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (currentPhase === "phase_3" || currentPhase === "completed") return null;

  const availableTargets: TargetPhase[] = currentPhase === "phase_1" ? ["phase_2", "phase_3"] : ["phase_3"];

  async function confirm() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/skip-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetPhase: target, asOfDate: new Date(asOfDate).toISOString() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(typeof data.error === "string" ? data.error : "Could not skip phase");
        setSubmitting(false);
        return;
      }
      setOpen(false);
      setSubmitting(false);
      router.refresh();
    } catch {
      setError("Could not reach the server");
      setSubmitting(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center justify-center rounded-lg border border-edge px-3 text-xs font-medium text-fg-muted transition-colors hover:border-edge-2 hover:bg-overlay hover:text-fg"
      >
        Skip phase…
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-20 flex w-72 flex-col gap-3 rounded-xl border border-edge bg-surface p-4 shadow-[var(--shadow-lg)]">
          <div>
            <h3 className="text-sm font-semibold text-fg">Skip to phase</h3>
            <p className="mt-0.5 text-xs text-fg-subtle">
              For a project already live past this point in the real world — backfills the steps
              in between rather than walking each one by hand.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">Target phase</label>
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value as TargetPhase)}
              className="h-9 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            >
              {availableTargets.map((t) => (
                <option key={t} value={t}>
                  {TARGET_LABEL[t]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-fg-muted">As of</label>
            <input
              type="date"
              value={asOfDate}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="h-9 w-full rounded-lg border border-edge bg-bg px-2 text-sm text-fg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>

          <p className="text-xs text-fg-subtle">{TARGET_SUMMARY[target]}</p>
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="flex h-8 items-center justify-center rounded-lg border border-edge px-3 text-xs font-medium text-fg-muted transition-colors hover:text-fg disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={submitting}
              className="flex h-8 items-center justify-center rounded-lg bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:opacity-50"
            >
              {submitting ? <Spinner className="h-3.5 w-3.5" /> : "Confirm skip"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
