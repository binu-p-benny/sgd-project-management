import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Department } from "@prisma/client";
import { getUnifiedMyTasks } from "@/lib/unified-tasks";
import { updateStepStatus } from "@/lib/step-actions";
import { createTestProjectDayOne, ensureTestUsers, cleanupTestProjects, getStep, prisma } from "../helpers/db";
import { advanceThroughPhase1, advanceThroughPhase2, patchProcurementItem } from "../helpers/scenarios";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

/** Finds this project's own row(s) in a getUnifiedMyTasks(...) result — every other test
 *  project in the (shared, real) dev DB is noise these tests don't care about. */
function tasksFor(all: Awaited<ReturnType<typeof getUnifiedMyTasks>>, projectId: string) {
  return all.filter((t) => t.project.id === projectId);
}

describe("getUnifiedMyTasks — procurement/glass-PO stages surface as their own task rows", () => {
  it("a day-one project (still phase_1) has no procurement_stage tasks yet — nobody can act on them before 1D", async () => {
    const project = await createTestProjectDayOne();
    const all = await getUnifiedMyTasks("purchase");
    expect(tasksFor(all, project.id).filter((t) => t.kind === "procurement_stage")).toHaveLength(0);
  });

  it("once Phase 1 completes, each item's first unfilled stage (Requirement created) shows up", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);

    const all = await getUnifiedMyTasks("design_engineer");
    const mine = tasksFor(all, project.id).filter((t) => t.kind === "procurement_stage");
    expect(mine).toHaveLength(3); // section, hardware, gasket
    for (const t of mine) {
      expect(t.taskLabel).toBe("Requirement created");
      expect(t.department).toBe("design_engineer");
      expect(t.status).toBe("not_started");
    }
  });

  it("filling in a stage advances that item to the next one, not the whole item disappearing", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await patchProcurementItem(project.id, "hardware", users.design_engineer, { requirementCreatedAt: new Date() });

    const all = await getUnifiedMyTasks("purchase");
    const mine = tasksFor(all, project.id).filter((t) => t.kind === "procurement_stage");
    const hardware = mine.find((t) => t.subTaskLabel === "Hardware");
    expect(hardware?.taskLabel).toBe("Quote created");
    expect(hardware?.department).toBe("purchase");
  });

  it("Payment done shows up for both Accounts and Purchase — see the secondary-department feature", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await patchProcurementItem(project.id, "gasket", users.design_engineer, { requirementCreatedAt: new Date() });
    await patchProcurementItem(project.id, "gasket", users.purchase, { quoteCreatedAt: new Date() });

    const forPurchase = tasksFor(await getUnifiedMyTasks("purchase"), project.id).filter(
      (t) => t.subTaskLabel === "Gasket"
    );
    const forAccounts = tasksFor(await getUnifiedMyTasks("accounts"), project.id).filter(
      (t) => t.subTaskLabel === "Gasket"
    );
    expect(forPurchase[0]?.taskLabel).toBe("Payment done");
    expect(forAccounts[0]?.taskLabel).toBe("Payment done");
    expect(forAccounts[0]?.secondaryDepartment).toBe("purchase");
  });

  it("a failed QC check produces an Action plan task, not the item just disappearing", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    const now = new Date();
    // Hardware/gasket, not section — section carries 2 extra fixed stages (material despatch,
    // arrived for powder coating) this test isn't filling in, which would otherwise become the
    // "next unfilled stage" instead of the Action plan this test is actually checking for.
    await patchProcurementItem(project.id, "hardware", users.design_engineer, { requirementCreatedAt: now });
    await patchProcurementItem(project.id, "hardware", users.purchase, {
      quoteCreatedAt: now,
      paymentSettledAt: now,
      orderConfirmedAt: now,
      actualArrivalDate: now,
    });
    await patchProcurementItem(project.id, "hardware", users.purchase, { qcCheckedAt: now, qcPassed: false });

    const all = tasksFor(await getUnifiedMyTasks("purchase"), project.id).filter((t) => t.subTaskLabel === "Hardware");
    expect(all).toHaveLength(1);
    expect(all[0].taskLabel).toBe("Action plan");
    expect(all[0].kind).toBe("procurement_stage");
  });

  it("once every stage (including QC pass) is done, the item has no open task left at all", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    const now = new Date();
    for (const itemType of ["section", "hardware", "gasket"] as const) {
      await patchProcurementItem(project.id, itemType, users.design_engineer, { requirementCreatedAt: now });
      await patchProcurementItem(project.id, itemType, users.purchase, {
        quoteCreatedAt: now,
        paymentSettledAt: now,
        orderConfirmedAt: now,
        // Section only — hardware/gasket never populate these two, same as ProcurementItem's own
        // schema comment says, but harmless to always pass (see patchProcurementItem's ...rest spread).
        materialDespatchAt: itemType === "section" ? now : undefined,
        arrivedForPowderCoatingAt: itemType === "section" ? now : undefined,
        actualArrivalDate: now,
        qcCheckedAt: now,
      });
    }
    const all = tasksFor(await getUnifiedMyTasks(null), project.id).filter((t) => t.kind === "procurement_stage");
    expect(all).toHaveLength(0);
  });
});

describe("getUnifiedMyTasks — excludes derived phase steps and soft-deleted projects", () => {
  it("never includes 2A/2D1/2F — their own sub-parts already show up as procurement_stage rows", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    const all = tasksFor(await getUnifiedMyTasks(null), project.id);
    expect(all.some((t) => t.kind === "phase_step" && ["2A", "2D1", "2F"].includes(t.stepCode ?? ""))).toBe(false);
  });

  it("a soft-deleted project contributes no tasks of any kind — regression for the prisma.ts soft-delete extension gap", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    const block = await prisma.workBlock.create({ data: { projectId: project.id, label: "Extra work" } });
    await prisma.workTask.create({
      data: { workBlockId: block.id, taskLabel: "Extra task", department: "purchase", plannedDate: new Date() },
    });
    const beforeCount = tasksFor(await getUnifiedMyTasks(null), project.id).length;
    expect(beforeCount).toBeGreaterThan(0);
    expect(tasksFor(await getUnifiedMyTasks(null), project.id).some((t) => t.kind === "work_task")).toBe(true);

    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
    const afterCount = tasksFor(await getUnifiedMyTasks(null), project.id).length;
    expect(afterCount).toBe(0);

    // Restore it so cleanupTestProjects' own soft-delete (by name prefix) still finds it — a
    // project already deleted here would otherwise be invisible to that cleanup query too.
    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: null } });
  });
});

describe("getUnifiedMyTasks — a project's own Additional works rows (WorkBlock/WorkTask)", () => {
  it("surfaces an open work task, scoped to the department it was assigned to, and disappears once completed", async () => {
    const project = await createTestProjectDayOne();
    const block = await prisma.workBlock.create({ data: { projectId: project.id, label: "Balcony railing" } });
    const task = await prisma.workTask.create({
      data: {
        workBlockId: block.id,
        taskLabel: "Confirm site visit date",
        department: "owner_admin",
        plannedDate: new Date("2026-10-01T00:00:00.000Z"),
      },
    });

    const forOwner = tasksFor(await getUnifiedMyTasks("owner_admin"), project.id);
    expect(forOwner).toHaveLength(1);
    expect(forOwner[0].kind).toBe("work_task");
    expect(forOwner[0].taskLabel).toBe("Confirm site visit date");
    // The work block's own label — the row's equivalent of an item-type/procurement-stage
    // subTaskLabel, so /my-tasks shows which block this belongs to.
    expect(forOwner[0].subTaskLabel).toBe("Balcony railing");
    // createTestProjectDayOne seeds a phase_1 project — the row should read the project's own
    // current phase, not some fixed value (see buildWorkTaskTasks' own comment on why).
    expect(forOwner[0].phase).toBe("phase_1");

    // Wrong department never sees it.
    expect(tasksFor(await getUnifiedMyTasks("purchase"), project.id)).toHaveLength(0);
    // Admin/owner's own department=null view sees every department's rows, this one included.
    expect(tasksFor(await getUnifiedMyTasks(null), project.id).some((t) => t.kind === "work_task")).toBe(true);

    await prisma.workTask.update({ where: { id: task.id }, data: { actualDate: new Date() } });
    expect(tasksFor(await getUnifiedMyTasks("owner_admin"), project.id)).toHaveLength(0);
  });

  it("PATCH /api/work-tasks/[id] is the endpoint TaskTable's simpleStageEndpoint routes a work_task row to", async () => {
    const project = await createTestProjectDayOne();
    const block = await prisma.workBlock.create({ data: { projectId: project.id, label: "Extra" } });
    await prisma.workTask.create({
      data: {
        workBlockId: block.id,
        taskLabel: "Whatever",
        department: "operations_manager",
        plannedDate: new Date(),
      },
    });

    const [row] = tasksFor(await getUnifiedMyTasks("operations_manager"), project.id);
    expect(row.dateField).toBe("actualDate");
    expect(row.noteField).toBe("note");
    // refId is the WorkTask's own id — /api/work-tasks/[id] is exactly PATCH /api/work-tasks/${refId}.
    expect(row.refId).toBeTruthy();
  });
});

describe("getUnifiedMyTasks — the Phase 1/3 customer review cards (PhaseReviewCard.tsx), HR & Admin only", () => {
  it("Phase 1 review is open from day one, using 2A's own planned end date, and only HR & Admin sees it", async () => {
    const project = await createTestProjectDayOne();
    const twoA = await getStep(project.id, "2A");

    const forHR = tasksFor(await getUnifiedMyTasks("hr_admin"), project.id);
    const review = forHR.find((t) => t.kind === "customer_review");
    expect(review).toBeDefined();
    expect(review!.taskLabel).toBe("Phase 1 customer review");
    expect(review!.phase).toBe("phase_1");
    expect(review!.plannedDate).toBe(twoA.plannedEndDate?.toISOString() ?? null);
    // refId is the Project's own id — PATCH /api/projects/[id] is where this saves, not a
    // dedicated sub-table like every other simple kind.
    expect(review!.refId).toBe(project.id);
    expect(review!.dateField).toBe("phase1ReviewActualEndDate");
    expect(review!.noteField).toBe("phase1ReviewNote");

    // No other department owns this — not even Design Engineer, who owns 2A itself.
    expect(tasksFor(await getUnifiedMyTasks("design_engineer"), project.id).some((t) => t.kind === "customer_review")).toBe(
      false
    );
    // Admin/owner's own department=null view sees it too, same as every other kind.
    expect(tasksFor(await getUnifiedMyTasks(null), project.id).some((t) => t.kind === "customer_review")).toBe(true);
  });

  it("Phase 1 review disappears once phase1ReviewActualEndDate is filled in", async () => {
    const project = await createTestProjectDayOne();
    await prisma.project.update({ where: { id: project.id }, data: { phase1ReviewActualEndDate: new Date() } });

    const forHR = tasksFor(await getUnifiedMyTasks("hr_admin"), project.id);
    expect(forHR.some((t) => t.kind === "customer_review" && t.phase === "phase_1")).toBe(false);
  });

  it("Phase 3 review doesn't exist yet on a day-one project — nothing to review before Phase 3 is real", async () => {
    const project = await createTestProjectDayOne();
    const forHR = tasksFor(await getUnifiedMyTasks("hr_admin"), project.id);
    expect(forHR.some((t) => t.kind === "customer_review" && t.phase === "phase_3")).toBe(false);
  });

  it("Phase 3 review appears once the project has actually reached Phase 3 (a 3E row exists), using 3E's own planned end date", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users); // seeds Phase 3, including 3E
    const threeE = await getStep(project.id, "3E");

    const forHR = tasksFor(await getUnifiedMyTasks("hr_admin"), project.id);
    const review = forHR.find((t) => t.kind === "customer_review" && t.phase === "phase_3");
    expect(review).toBeDefined();
    expect(review!.taskLabel).toBe("Phase 3 customer review");
    expect(review!.plannedDate).toBe(threeE.plannedEndDate?.toISOString() ?? null);
    expect(review!.refId).toBe(project.id);
    expect(review!.dateField).toBe("phase3ReviewActualEndDate");
    expect(review!.noteField).toBe("phase3ReviewNote");

    // Phase 1's review is still its own, separate, still-open row — filling in Phase 3's data
    // never touches it.
    expect(forHR.some((t) => t.kind === "customer_review" && t.phase === "phase_1")).toBe(true);
  });

  it("Phase 3 review disappears once phase3ReviewActualEndDate is filled in, independently of Phase 1's", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    await prisma.project.update({ where: { id: project.id }, data: { phase3ReviewActualEndDate: new Date() } });

    const forHR = tasksFor(await getUnifiedMyTasks("hr_admin"), project.id);
    expect(forHR.some((t) => t.kind === "customer_review" && t.phase === "phase_3")).toBe(false);
    expect(forHR.some((t) => t.kind === "customer_review" && t.phase === "phase_1")).toBe(true);
  });
});

describe("getUnifiedMyTasks — 3C1's own contractor-selection sub-task", () => {
  it("surfaces the Section item's requirement-created date as contractorPlannedDate, overdue once it's genuinely in the past", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users); // drives 2F to completed, seeding Phase 3 (3C1)
    // Overdue is a calendar-day check (see overrun.ts's isProcurementStageOverrun) — backdated a
    // full 5 days rather than relying on "just now" being in the past, which after
    // advanceThroughPhase2 is still *today* and so no longer counts as overdue (see the
    // "not overdue the same day" test right below, which covers exactly that case).
    const past = new Date(Date.now() - 1000 * 60 * 60 * 24 * 5);
    await patchProcurementItem(project.id, "section", users.design_engineer, { requirementCreatedAt: past });

    const all = tasksFor(await getUnifiedMyTasks("project_engineer"), project.id);
    const threeC1 = all.find((t) => t.kind === "phase_step" && t.stepCode === "3C1");
    expect(threeC1).toBeDefined();
    expect(threeC1!.contractorId).toBeNull();
    expect(threeC1!.contractorPlannedDate).toBe(past.toISOString());
    // See MyTaskItem's own contractorOverdue for the same rule on the project-detail page.
    expect(threeC1!.contractorOverdue).toBe(true);
  });

  it("not overdue the same day the Section requirement was created — due today isn't overdue yet", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users); // Section's requirement is created just now — i.e. today

    const all = tasksFor(await getUnifiedMyTasks("project_engineer"), project.id);
    const threeC1 = all.find((t) => t.kind === "phase_step" && t.stepCode === "3C1");
    expect(threeC1!.contractorPlannedDate).not.toBeNull();
    expect(threeC1!.contractorOverdue).toBe(false);
  });

  it("not overdue while the Section requirement's date is still in the future", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    const future = new Date(Date.now() + 1000 * 60 * 60 * 24 * 5);
    await patchProcurementItem(project.id, "section", users.design_engineer, { requirementCreatedAt: future });

    const all = tasksFor(await getUnifiedMyTasks(null), project.id);
    const threeC1 = all.find((t) => t.kind === "phase_step" && t.stepCode === "3C1");
    expect(threeC1!.contractorPlannedDate).toBe(future.toISOString());
    expect(threeC1!.contractorOverdue).toBe(false);
  });

  it("clears once a contractor is set directly on the step — no longer overdue either", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    const threeC1Step = await getStep(project.id, "3C1");
    const contractor = await prisma.contractor.create({
      data: { name: "__TEST__ Contractor Co", phone: "9999999999", address: "Test address" },
    });
    try {
      await prisma.phaseStep.update({ where: { id: threeC1Step.id }, data: { contractorId: contractor.id } });

      const all = tasksFor(await getUnifiedMyTasks(null), project.id);
      const threeC1 = all.find((t) => t.kind === "phase_step" && t.stepCode === "3C1");
      expect(threeC1!.contractorId).toBe(contractor.id);
      expect(threeC1!.contractorName).toBe("__TEST__ Contractor Co");
      expect(threeC1!.contractorOverdue).toBe(false);
    } finally {
      await prisma.contractor.delete({ where: { id: contractor.id } });
    }
  });

  it("is its own task row — separate from 3C1's own 'Aluminum framework' row, with its own due date — while unset", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);

    const all = tasksFor(await getUnifiedMyTasks("project_engineer"), project.id);
    const contractorTasks = all.filter((t) => t.kind === "contractor_selection");
    const threeC1 = all.find((t) => t.kind === "phase_step" && t.stepCode === "3C1");
    expect(contractorTasks).toHaveLength(1);
    expect(threeC1).toBeDefined();

    const contractorTask = contractorTasks[0];
    // Its own row's plannedDate/overrun are the contractor due date, not 3C1's own planned dates —
    // that's the whole point of splitting it out (they're due on different schedules).
    expect(contractorTask.taskLabel).toBe("Select contractor");
    expect(contractorTask.subTaskLabel).toBe(threeC1!.taskLabel);
    expect(contractorTask.refId).toBe(threeC1!.refId);
    expect(contractorTask.plannedDate).toBe(contractorTask.contractorPlannedDate);
    expect(contractorTask.overrun).toBe(contractorTask.contractorOverdue);
    expect(contractorTask.plannedDate).not.toBe(threeC1!.plannedDate);
  });

  it("the separate contractor_selection row disappears once a contractor is set — only the phase_step row remains", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    const threeC1Step = await getStep(project.id, "3C1");
    const contractor = await prisma.contractor.create({
      data: { name: "__TEST__ Contractor Co 2", phone: "9999999998", address: "Test address" },
    });
    try {
      await prisma.phaseStep.update({ where: { id: threeC1Step.id }, data: { contractorId: contractor.id } });

      const all = tasksFor(await getUnifiedMyTasks(null), project.id);
      expect(all.some((t) => t.kind === "contractor_selection")).toBe(false);
      expect(all.filter((t) => t.stepCode === "3C1")).toHaveLength(1);
    } finally {
      await prisma.contractor.delete({ where: { id: contractor.id } });
    }
  });
});

describe("getUnifiedMyTasks — admin-delegated planned-date editing (plannedDateEditDepartment)", () => {
  it("doesn't appear for anyone until an admin delegates it", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users); // seeds 3C1

    const all = tasksFor(await getUnifiedMyTasks("design_engineer"), project.id);
    expect(all.some((t) => t.kind === "planned_date_edit")).toBe(false);
  });

  it("appears only for the delegated department, as its own task — not the owning department's, which keeps its normal phase_step row", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    const threeC1 = await getStep(project.id, "3C1");
    await prisma.phaseStep.update({
      where: { id: threeC1.id },
      data: { plannedDateEditDepartment: "design_engineer" },
    });

    const delegated = tasksFor(await getUnifiedMyTasks("design_engineer"), project.id);
    const editTask = delegated.find((t) => t.kind === "planned_date_edit");
    expect(editTask).toBeDefined();
    expect(editTask!.taskLabel).toBe("Set planned dates");
    expect(editTask!.subTaskLabel).toBe(threeC1.stepName);
    expect(editTask!.refId).toBe(threeC1.id);
    expect(editTask!.department).toBe("design_engineer");

    // project_engineer (3C1's actual owning department) wasn't delegated this — no edit task for
    // them, but their own phase_step row for 3C1 is untouched.
    const owning = tasksFor(await getUnifiedMyTasks("project_engineer"), project.id);
    expect(owning.some((t) => t.kind === "planned_date_edit")).toBe(false);
    expect(owning.some((t) => t.kind === "phase_step" && t.stepCode === "3C1")).toBe(true);
  });

  it("admin (department=null) sees every delegated task regardless of which department it went to", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    const threeC1 = await getStep(project.id, "3C1");
    await prisma.phaseStep.update({
      where: { id: threeC1.id },
      data: { plannedDateEditDepartment: "purchase" },
    });

    const all = tasksFor(await getUnifiedMyTasks(null), project.id);
    expect(all.some((t) => t.kind === "planned_date_edit" && t.refId === threeC1.id)).toBe(true);
  });

  it("shows up even while the step is still gated behind an unmet dependency — planning ahead is the point", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users); // neither 3B nor 3C2 done yet — 3E still gated on both
    const threeE = await getStep(project.id, "3E");
    await prisma.phaseStep.update({
      where: { id: threeE.id },
      data: { plannedDateEditDepartment: "design_engineer" },
    });

    const all = tasksFor(await getUnifiedMyTasks("design_engineer"), project.id);
    const editTask = all.find((t) => t.kind === "planned_date_edit" && t.refId === threeE.id);
    expect(editTask).toBeDefined();
    // Its sibling phase_step row for 3E is correctly absent for this department (design_engineer
    // isn't 3E's owning department, and it's gated besides) — only the edit task shows.
    expect(all.some((t) => t.kind === "phase_step" && t.stepCode === "3E")).toBe(false);
  });

  it("disappears once both planned dates are filled in and locked", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    const threeC1 = await getStep(project.id, "3C1");
    await prisma.phaseStep.update({
      where: { id: threeC1.id },
      data: {
        plannedDateEditDepartment: "design_engineer",
        plannedStartDate: new Date(),
        plannedEndDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
      },
    });

    const all = tasksFor(await getUnifiedMyTasks("design_engineer"), project.id);
    expect(all.some((t) => t.kind === "planned_date_edit")).toBe(false);
  });

  it("3E (end-only) locks with just a Planned end — no start ever required", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    const threeE = await getStep(project.id, "3E");
    await prisma.phaseStep.update({
      where: { id: threeE.id },
      data: { plannedDateEditDepartment: "hr_admin" },
    });

    const beforeEnd = tasksFor(await getUnifiedMyTasks("hr_admin"), project.id);
    expect(beforeEnd.some((t) => t.kind === "planned_date_edit" && t.refId === threeE.id)).toBe(true);

    await prisma.phaseStep.update({
      where: { id: threeE.id },
      data: { plannedEndDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 20) },
    });

    const afterEnd = tasksFor(await getUnifiedMyTasks("hr_admin"), project.id);
    expect(afterEnd.some((t) => t.kind === "planned_date_edit" && t.refId === threeE.id)).toBe(false);
  });
});

describe("getUnifiedMyTasks — sorting", () => {
  it("returns tasks ascending by planned date, with no-date tasks last — after any planned_date_edit rows, which jump ahead of everything (see the dedicated test below)", async () => {
    const all = await getUnifiedMyTasks(null);
    const firstOrdinary = all.findIndex((t) => t.kind !== "planned_date_edit");
    const rest = firstOrdinary === -1 ? [] : all.slice(firstOrdinary);
    expect(all.slice(0, firstOrdinary === -1 ? all.length : firstOrdinary).every((t) => t.kind === "planned_date_edit")).toBe(
      true
    );

    const dated = rest.filter((t) => t.plannedDate !== null).map((t) => t.plannedDate!);
    const sorted = [...dated].sort();
    expect(dated).toEqual(sorted);

    const firstNoDateIndex = rest.findIndex((t) => t.plannedDate === null);
    if (firstNoDateIndex !== -1) {
      expect(rest.slice(firstNoDateIndex).every((t) => t.plannedDate === null)).toBe(true);
    }
  });

  it("puts a planned_date_edit task ahead of every other row, even ones already overdue", async () => {
    const project = await createTestProjectDayOne();
    await advanceThroughPhase1(project.id, users);
    await advanceThroughPhase2(project.id, users);
    const threeC1 = await getStep(project.id, "3C1");
    await prisma.phaseStep.update({
      where: { id: threeC1.id },
      data: { plannedDateEditDepartment: "design_engineer" },
    });

    const all = await getUnifiedMyTasks(null);
    const editIndex = all.findIndex((t) => t.kind === "planned_date_edit" && t.refId === threeC1.id);
    expect(editIndex).toBeGreaterThanOrEqual(0);
    // Not asserting index 0 outright — another planned_date_edit row elsewhere in the (shared)
    // dev DB could legitimately sort before this one too. What matters is that nothing *else*
    // (dated or not) ever precedes it.
    expect(all.slice(0, editIndex).every((t) => t.kind === "planned_date_edit")).toBe(true);
  });

  it("updateStepStatus's own actualEndDate option feeds straight through the same PhaseStep row unified-tasks reads", async () => {
    const project = await createTestProjectDayOne();
    const oneA = await prisma.phaseStep.findFirstOrThrow({ where: { projectId: project.id, stepCode: "1A" } });
    const backdated = new Date("2020-06-01T00:00:00.000Z");
    await updateStepStatus(oneA.id, "in_progress", users.hr_admin, { actualStartDate: backdated });

    const step = await prisma.phaseStep.findUniqueOrThrow({ where: { id: oneA.id } });
    expect(step.actualStartDate?.toISOString()).toBe(backdated.toISOString());
  });
});
