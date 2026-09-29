"use client";

import { useState } from "react";
import type { PortalProject, PortalStep } from "@/lib/client-portal";
import {
  PORTAL_PHASE_LABELS,
  PORTAL_STATUS_LABELS,
  PORTAL_STATUS_STYLES,
  portalStepLabel,
  portalStepNote,
  portalStepTitle,
} from "@/lib/portal-labels";
import type { StepPhase, StepStatus } from "@prisma/client";

const PHASE_ORDER: StepPhase[] = ["phase_1", "phase_2", "phase_3"];

/** Tick, dot or nothing inside the node — the same vocabulary the staff overview uses. */
function NodeMark({ status }: { status: StepStatus }) {
  if (status === "completed") {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={3} className="h-3 w-3 stroke-white sm:h-3.5 sm:w-3.5">
        <path d="M5 12.5 10 17l9-10" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "in_progress") return <span className="h-1.5 w-1.5 rounded-full bg-white" />;
  if (status === "blocked") {
    return (
      <svg viewBox="0 0 24 24" fill="none" strokeWidth={3} className="h-3 w-3 stroke-white">
        <path d="M12 7v6" strokeLinecap="round" />
        <circle cx="12" cy="17" r="1.2" fill="white" stroke="none" />
      </svg>
    );
  }
  return null; // not started: an empty ring
}

/**
 * One phase as a connected run of nodes — the shape the project page's own Progress overview
 * uses (StepProgressBar), redrawn in the portal's palette and with the client's wording.
 *
 * The run scrolls sideways on a narrow screen instead of squeezing: five nodes can't sit
 * legibly across 320px, and a cramped row is worse than a swipe. The negative margin lets that
 * scroll area bleed to the screen edge while its content keeps the page gutter.
 */
/**
 * One node and its lines of text, shared by both layouts. `gapCaption` is what's happening while
 * this step waits for the next one (e.g. "In transit - material dispatched") — shown as an extra
 * line so it reads as "here's the wait", not part of the node's own status.
 */
function StepNode({ step, align }: { step: PortalStep; align: "center" | "left" }) {
  const style = PORTAL_STATUS_STYLES[step.status];
  const label = portalStepLabel(step.stepCode, step.stepName);
  const note = portalStepNote(step);
  return (
    <div className={align === "center" ? "text-center" : "text-left"}>
      <span className={`block text-[12px] leading-tight sm:text-[11px] ${style.text}`}>{label}</span>
      {note && <span className="mt-0.5 block text-[11px] leading-tight text-fg-subtle sm:text-[10px]">{note}</span>}
      {step.gapCaption && (
        <span
          className={`mt-0.5 block text-[11px] leading-tight sm:text-[10px] ${
            step.gapDelayed ? "text-[#9a6b1f]" : "text-fg-subtle italic"
          }`}
        >
          {step.gapCaption}
        </span>
      )}
    </div>
  );
}

function NodeCircle({ step }: { step: PortalStep }) {
  const style = PORTAL_STATUS_STYLES[step.status];
  const label = portalStepLabel(step.stepCode, step.stepName);
  return (
    <span
      title={portalStepTitle(label, step)}
      aria-label={`${label}: ${PORTAL_STATUS_LABELS[step.status]}`}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border ${style.node} sm:h-7 sm:w-7`}
    >
      <NodeMark status={step.status} />
    </span>
  );
}

/**
 * One phase, drawn two ways for two widths rather than one way that has to squeeze.
 *
 * Below sm it runs down the page — node, label beside it, a rule dropping to the next — because
 * five nodes cannot sit legibly across 320px, and the sideways-scrolling version this replaces
 * hid half a phase off the edge of the screen behind a swipe nobody was told about. From sm up
 * there is room for the run the project page itself uses, left to right.
 */
function PhaseRun({ phase, steps }: { phase: StepPhase; steps: PortalStep[] }) {
  if (steps.length === 0) return null;
  const done = steps.filter((s) => s.status === "completed").length;

  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[13px] uppercase tracking-[0.18em] text-fg-muted">{PORTAL_PHASE_LABELS[phase]}</h3>
        <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-subtle">
          {done}/{steps.length}
        </span>
      </div>

      {/* Vertical, below sm */}
      <ol className="flex flex-col sm:hidden">
        {steps.map((step, i) => {
          const style = PORTAL_STATUS_STYLES[step.status];
          const last = i === steps.length - 1;
          return (
            <li key={step.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <NodeCircle step={step} />
                {!last && (
                  <span
                    aria-hidden
                    className={`w-px flex-1 ${
                      step.status === "completed"
                        ? style.connector
                        : step.gapDelayed
                          ? "bg-[#9a6b1f]"
                          : "bg-[rgba(17,17,17,0.18)]"
                    }`}
                  />
                )}
              </div>
              <div className={last ? "pt-0.5" : "pb-5 pt-0.5"}>
                <StepNode step={step} align="left" />
              </div>
            </li>
          );
        })}
      </ol>

      {/* Horizontal, from sm up */}
      <div className="hidden items-start sm:flex">
        {steps.map((step, i) => {
          const style = PORTAL_STATUS_STYLES[step.status];
          return (
            <div key={step.id} className="flex flex-1 items-start last:flex-none">
              <div className="flex w-[104px] shrink-0 flex-col items-center gap-1.5">
                <NodeCircle step={step} />
                <StepNode step={step} align="center" />
              </div>
              {i < steps.length - 1 && (
                <div
                  aria-hidden
                  className={`mx-1 mt-3.5 h-px min-w-[14px] flex-1 ${
                    step.status === "completed"
                      ? style.connector
                      : step.gapDelayed
                        ? "bg-[#9a6b1f]"
                        : "bg-[rgba(17,17,17,0.18)]"
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Legend() {
  const items: { status: StepStatus }[] = [
    { status: "completed" },
    { status: "in_progress" },
    { status: "blocked" },
    { status: "not_started" },
  ];
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1.5 border-t border-edge pt-3 text-[11px] text-fg-muted">
      {items.map(({ status }) => (
        <span key={status} className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full border ${PORTAL_STATUS_STYLES[status].node}`} />
          {PORTAL_STATUS_LABELS[status]}
        </span>
      ))}
    </div>
  );
}

export function PortalProgress({ projects, firstName }: { projects: PortalProject[]; firstName: string }) {
  // Projects arrive newest first, so index 0 is the one a client almost always wants; the
  // switcher is how they reach the older ones, one at a time.
  const [index, setIndex] = useState(0);
  const project = projects[index];
  if (!project) return null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 pb-16 pt-5 sm:gap-7 sm:px-8 sm:pt-7">
      {/* Greeting and switcher share one line so the timeline starts inside the first screen. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <p className="text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
          Welcome, <span className="text-fg-muted">{firstName}</span>
        </p>
        {projects.length > 1 && (
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {projects.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? "true" : undefined}
                className={`border-b pb-0.5 text-[12px] transition-colors ${
                  i === index
                    ? "border-fg text-fg"
                    : "border-transparent text-fg-subtle hover:border-edge-2 hover:text-fg-muted"
                }`}
              >
                {p.name}
                {i === 0 && <span className="ml-1.5 text-[9px] uppercase tracking-[0.16em]">latest</span>}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Name on the left, the headline number on the right — one band instead of two stacked
          blocks, which is what used to push the steps below the fold. */}
      <div className="flex flex-col gap-4 border-b border-edge pb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-10">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
            {project.isComplete ? "Completed project" : "Project in progress"}
          </p>
          <h2 className="mt-2 text-[26px] leading-[1.12] text-fg sm:text-[34px]">{project.name}</h2>
          <p className="mt-2 text-[12px] text-fg-muted">
            {PORTAL_PHASE_LABELS[(project.currentPhase === "completed" ? "phase_3" : project.currentPhase) as StepPhase]}
            {project.currentPhase === "completed" ? " · finished" : " in progress"}
          </p>
        </div>

        <div className="w-full sm:max-w-[260px]">
          <div className="flex items-end justify-between gap-3">
            <span className="text-[40px] leading-none text-fg sm:text-[46px]">{project.percentComplete}%</span>
            <span className="pb-1.5 text-[11px] text-fg-subtle">
              {project.completedSteps} of {project.totalSteps} steps
            </span>
          </div>
          <div className="mt-2.5 h-[3px] w-full bg-[rgba(17,17,17,0.12)]">
            <div
              className="h-full bg-[#111111] transition-[width] duration-500"
              style={{ width: `${project.percentComplete}%` }}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6 sm:gap-7">
        {PHASE_ORDER.map((phase) => (
          <PhaseRun key={phase} phase={phase} steps={project.steps.filter((s) => s.phase === phase)} />
        ))}
      </div>

      <Legend />

      {projects.length > 1 && (
        <div className="flex items-center justify-between border-t border-edge pt-4">
          <button
            type="button"
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="text-[11px] uppercase tracking-[0.18em] text-fg-muted transition-opacity hover:text-fg disabled:opacity-30"
          >
            ← Newer project
          </button>
          <span className="text-[11px] uppercase tracking-[0.18em] text-fg-subtle">
            {index + 1} / {projects.length}
          </span>
          <button
            type="button"
            onClick={() => setIndex((i) => Math.min(projects.length - 1, i + 1))}
            disabled={index === projects.length - 1}
            className="text-[11px] uppercase tracking-[0.18em] text-fg-muted transition-opacity hover:text-fg disabled:opacity-30"
          >
            Older project →
          </button>
        </div>
      )}
    </div>
  );
}
