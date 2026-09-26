"use client";

import { useState } from "react";
import type { PortalProject } from "@/lib/client-portal";
import {
  PORTAL_PHASE_LABELS,
  PORTAL_STATUS_LABELS,
  PORTAL_STATUS_STYLES,
  formatPortalDate,
  portalStepDetail,
  portalStepLabel,
} from "@/lib/portal-labels";
import type { StepPhase } from "@prisma/client";

const PHASE_ORDER: StepPhase[] = ["phase_1", "phase_2", "phase_3"];

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div className="h-[3px] w-full bg-[rgba(17,17,17,0.12)]">
      <div className="h-full bg-[#111111] transition-[width] duration-500" style={{ width: `${percent}%` }} />
    </div>
  );
}

function PhaseBlock({ phase, project }: { phase: StepPhase; project: PortalProject }) {
  const steps = project.steps.filter((s) => s.phase === phase);
  if (steps.length === 0) return null;

  const done = steps.filter((s) => s.status === "completed").length;

  return (
    <section className="border-t border-edge py-8 first:border-t-0 sm:py-10">
      <div className="flex items-baseline justify-between gap-4">
        <h3 className="text-[19px] text-fg sm:text-[22px]">{PORTAL_PHASE_LABELS[phase]}</h3>
        <span className="shrink-0 text-[11px] uppercase tracking-[0.16em] text-fg-subtle">
          {done} of {steps.length} done
        </span>
      </div>

      <ol className="mt-6 flex flex-col">
        {steps.map((step) => {
          const style = PORTAL_STATUS_STYLES[step.status];
          const detail = portalStepDetail(step);
          return (
            <li key={step.id} className="flex gap-4 border-b border-edge py-3.5 last:border-b-0">
              <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${style.dot}`} aria-hidden />
              {/* One structure at every width: the name sits left, the outcome right. On a phone
                  the outcome wraps to its own line and reads inline (status then detail); from
                  sm up there's room to stack the two right-aligned beside the name. */}
              <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
                <span className="text-[15px] text-fg">{portalStepLabel(step.stepCode, step.stepName)}</span>
                <span className="flex flex-wrap items-baseline gap-x-2 sm:flex-col sm:items-end sm:gap-0 sm:text-right">
                  <span className={`text-[13px] ${style.text}`}>{PORTAL_STATUS_LABELS[step.status]}</span>
                  {detail && <span className="text-[12px] text-fg-subtle">{detail}</span>}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export function PortalProgress({ projects }: { projects: PortalProject[] }) {
  // Projects arrive newest first, so index 0 is the one a client almost always wants; the
  // switcher below is how they reach the older ones, one at a time.
  const [index, setIndex] = useState(0);
  const project = projects[index];
  if (!project) return null;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 pb-20 sm:px-8">
      {projects.length > 1 && (
        <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-edge py-5">
          <span className="text-[11px] uppercase tracking-[0.18em] text-fg-subtle">
            Your projects ({projects.length})
          </span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {projects.map((p, i) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setIndex(i)}
                aria-current={i === index ? "true" : undefined}
                className={`border-b pb-0.5 text-[13px] transition-colors ${
                  i === index
                    ? "border-fg text-fg"
                    : "border-transparent text-fg-subtle hover:border-edge-2 hover:text-fg-muted"
                }`}
              >
                {p.name}
                {i === 0 && <span className="ml-2 text-[10px] uppercase tracking-[0.16em]">latest</span>}
              </button>
            ))}
          </div>
        </nav>
      )}

      <div className="pt-10 sm:pt-14">
        <p className="text-[11px] uppercase tracking-[0.2em] text-fg-subtle">
          {project.isComplete ? "Completed project" : "Project in progress"}
        </p>
        <h2 className="mt-3 text-[32px] leading-[1.1] text-fg sm:text-[42px]">{project.name}</h2>

        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-3 text-[13px]">
          <div>
            <dt className="text-fg-subtle">Started</dt>
            <dd className="mt-0.5 text-fg">{formatPortalDate(project.startedOn) ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Stage</dt>
            <dd className="mt-0.5 text-fg">
              {PORTAL_PHASE_LABELS[
                (project.currentPhase === "completed" ? "phase_3" : project.currentPhase) as StepPhase
              ]}
              {project.currentPhase === "completed" && " · finished"}
            </dd>
          </div>
          <div>
            <dt className="text-fg-subtle">Steps done</dt>
            <dd className="mt-0.5 text-fg">
              {project.completedSteps} of {project.totalSteps}
            </dd>
          </div>
        </dl>

        <div className="mt-10">
          <div className="flex items-end justify-between">
            <span className="text-[52px] leading-none text-fg sm:text-[64px]">{project.percentComplete}%</span>
            <span className="pb-2 text-[11px] uppercase tracking-[0.18em] text-fg-subtle">complete</span>
          </div>
          <div className="mt-4">
            <ProgressBar percent={project.percentComplete} />
          </div>
        </div>
      </div>

      <div className="mt-12 sm:mt-16">
        {PHASE_ORDER.map((phase) => (
          <PhaseBlock key={phase} phase={phase} project={project} />
        ))}
      </div>

      {projects.length > 1 && (
        <div className="flex items-center justify-between border-t border-edge pt-6">
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
