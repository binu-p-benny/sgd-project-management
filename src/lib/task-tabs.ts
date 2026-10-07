import type { UnifiedTask } from "@/lib/unified-tasks";

export type TaskGroupTab = "project" | "service" | "follow_up";

/**
 * Which of the three tabs a task belongs under — /open-work's DepartmentTaskOverview and
 * /my-tasks' own TaskTable both split on this. Kept in its own module, importing only
 * UnifiedTask's *type* (erased at build time), rather than living in unified-tasks.ts itself —
 * that file pulls in the Prisma client, and both call sites here are "use client" components;
 * importing a runtime value from it would drag Prisma into the browser bundle (see the RSC/
 * client boundary note elsewhere in this codebase).
 *
 * A follow-up wins over its own underlying phase even once it's reviewed and done: an open
 * follow-up carries kind === "follow_up" (see buildFollowUpTasks), but task-reviews.ts'
 * followUpReviewTasks rebuilds a *completed* one as kind === "review_completed" instead (the same
 * kind every other reviewable unit uses) — its own refId is still the "follow_up:<id>" composite
 * id reviewed-follow-up rows are built with, so checking that prefix is what still finds it once
 * it's moved kind. Everything else is either a service's own work (phase === "service") or
 * ordinary project work (phase_1/2/3, plus common_task's project-less "general").
 */
export function taskGroupTab(task: UnifiedTask): TaskGroupTab {
  const isFollowUp = task.kind === "follow_up" || (task.kind === "review_completed" && task.refId.startsWith("follow_up:"));
  if (isFollowUp) return "follow_up";
  return task.phase === "service" ? "service" : "project";
}
