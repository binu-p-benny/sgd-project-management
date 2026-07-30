import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus, planStepRevert, revertStep } from "@/lib/step-actions";
import { checkDependencyGate } from "@/lib/dependency-gate";
import {
  createTestProject,
  ensureTestUsers,
  getStep,
  findStep,
  getProject,
  getProcurementItems,
  getStatusLogs,
  cleanupTestProjects,
  prisma,
} from "../helpers/db";
import {
  advanceThroughPhase1,
  advanceThroughPhase2,
  patchProcurementItem,
  markAllRequirementsCreated,
} from "../helpers/scenarios";
import type { Department } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

const REASON = "wrong info captured";

describe("reverting a completed step reopens it for correction", () => {
  it("moves it back to in_progress and clears actual_end_date", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "emergency" });

    expect((await getStep(project.id, "1A")).actualEndDate).not.toBeNull();

    await revertStep(oneA.id, users.owner_admin, { reason: REASON });

    const after = await getStep(project.id, "1A");
    expect(after.status).toBe("in_progress");
    expect(after.actualEndDate).toBeNull();
  });

  it("records the reason on the step's status log", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "emergency" });
    await revertStep(oneA.id, users.owner_admin, { reason: REASON });

    const logs = await getStatusLogs(oneA.id);
    const revertLog = logs.at(-1)!;
    expect(revertLog.oldStatus).toBe("completed");
    expect(revertLog.newStatus).toBe("in_progress");
    expect(revertLog.reason).toContain(REASON);
    expect(revertLog.changedByUserId).toBe(users.owner_admin);
  });

  it("resets a started step to not_started, clearing actual_start_date too", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "in_progress", users.hr_admin);
    expect((await getStep(project.id, "1A")).actualStartDate).not.toBeNull();

    await revertStep(oneA.id, users.owner_admin, { reason: REASON });

    const after = await getStep(project.id, "1A");
    expect(after.status).toBe("not_started");
    expect(after.actualStartDate).toBeNull();
  });

  it("clears the blocker when reverting a blocked step", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "blocked", users.hr_admin, { blockedReason: "client_hold" });

    await revertStep(oneA.id, users.owner_admin, { reason: REASON });

    const after = await getStep(project.id, "1A");
    expect(after.status).toBe("not_started");
    expect(after.blockedReason).toBeNull();
    expect(after.blockedNote).toBeNull();
  });

  it("refuses a step that is already not_started, and refuses an empty reason", async () => {
    const project = await createTestProject();
    const oneB = await getStep(project.id, "1B");
    await expect(revertStep(oneB.id, users.owner_admin, { reason: REASON })).rejects.toMatchObject({
      status: 400,
    });

    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "emergency" });
    await expect(revertStep(oneA.id, users.owner_admin, { reason: "   " })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("a revert leaves nothing behind from after the step", () => {
  it("discards notes on the reverted step and on every step cascaded with it", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");

    await prisma.phaseStep.updateMany({
      where: { projectId: project.id, stepCode: { in: ["1B", "1C", "1D"] } },
      data: { notes: "recorded during work that is being undone" },
    });

    const oneB = await getStep(project.id, "1B");
    const plan = await planStepRevert(oneB.id);
    expect(plan.clearsStepNotes).toBe(true);

    await revertStep(oneB.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    for (const code of ["1B", "1C", "1D"]) {
      expect((await getStep(project.id, code)).notes).toBeNull();
    }
    // 1A is upstream — untouched, notes and all.
    await prisma.phaseStep.updateMany({
      where: { projectId: project.id, stepCode: "1A" },
      data: { notes: "kept" },
    });
    expect((await getStep(project.id, "1A")).notes).toBe("kept");
  });

  it("blanks the planned dates of a phase whose gate step is no longer complete", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");

    for (const code of ["2A", "2D1", "2D2", "2F"]) {
      expect((await getStep(project.id, code)).plannedStartDate).not.toBeNull();
    }

    const oneD = await getStep(project.id, "1D");
    await revertStep(oneD.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    // Phase 2 is no longer unlocked, so it carries no schedule — same as a project that has
    // not reached it yet. Projecting from a gate that has not finished would be a claim the
    // record no longer supports.
    for (const code of ["2A", "2D1", "2D2", "2F"]) {
      const step = await getStep(project.id, code);
      expect(step.plannedStartDate).toBeNull();
      expect(step.plannedEndDate).toBeNull();
      expect(step.actualStartDate).toBeNull();
      expect(step.actualEndDate).toBeNull();
    }
    // Phase 1 has no gate above it, so it keeps its ordinary forward projection.
    expect((await getStep(project.id, "1D")).plannedEndDate).not.toBeNull();
  });

  it("restores the phase's planned dates when the gate is completed again", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");

    const oneD = await getStep(project.id, "1D");
    await revertStep(oneD.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });
    expect((await getStep(project.id, "2A")).plannedStartDate).toBeNull();

    await updateStepStatus(oneD.id, "completed", users.accounts);

    for (const code of ["2A", "2D1", "2D2", "2F"]) {
      const step = await getStep(project.id, code);
      expect(step.plannedStartDate).not.toBeNull();
      expect(step.plannedEndDate).not.toBeNull();
    }
  });

  it("clears the visit urgency that completing 1A had set", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "completed", users.hr_admin, { visitUrgency: "hot" });
    expect((await getProject(project.id)).visitUrgency).toBe("hot");

    const plan = await planStepRevert(oneA.id);
    expect(plan.projectDataClears).toContain("the visit urgency");
    // Re-picking it is part of completing 1A again, so this alone does not need a confirmation.
    expect(plan.needsConsent).toBe(false);

    await revertStep(oneA.id, users.owner_admin, { reason: REASON });
    expect((await getProject(project.id)).visitUrgency).toBeNull();

    // 1B's duration only ever came from that urgency, so it goes back to unset — which leaves
    // 1B's own planned end unresolved, exactly as it is on a project where 1A is not done.
    const oneB = await getStep(project.id, "1B");
    expect(oneB.plannedDurationDays).toBeNull();
    expect(oneB.plannedEndDate).toBeNull();
  });

  it("resets the payment 1D recorded, and asks before doing it", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await prisma.project.update({
      where: { id: project.id },
      data: { paymentStatus: "partial", amountReceived: 50000, notes: "half paid up front" },
    });

    const oneD = await getStep(project.id, "1D");
    const plan = await planStepRevert(oneD.id);
    expect(plan.projectDataClears).toContain(
      "the payment status, amount received and payment note"
    );
    expect(plan.needsConsent).toBe(true);

    await expect(revertStep(oneD.id, users.owner_admin, { reason: REASON })).rejects.toMatchObject({
      status: 409,
    });
    expect(Number((await getProject(project.id)).amountReceived)).toBe(50000);

    await revertStep(oneD.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    const after = await getProject(project.id);
    expect(after.paymentStatus).toBe("pending");
    expect(Number(after.amountReceived)).toBe(0);
    expect(after.notes).toBeNull();
  });
});

describe("the cascade follows the timeline, not just the dependency graph", () => {
  it("reverting 2D2 still rolls back phase 3, though nothing declares a dependency on it", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await advanceThroughPhase2(project.id, users);
    for (const code of ["2D2", "3A", "3C1"]) {
      const step = await getStep(project.id, code);
      await updateStepStatus(step.id, "completed", users.owner_admin);
    }

    // Nothing in the template lists 2D2 in its depends_on — a graph walk from it finds nothing,
    // which is what used to leave phase 3 untouched here.
    const twoD2 = await getStep(project.id, "2D2");
    const plan = await planStepRevert(twoD2.id);
    expect(plan.cascade.map((s) => s.stepCode)).toEqual(["3A", "3C1"]);
    // 2F comes after 2D2, so its QC data is in scope; 2A and 2D1 come before it and are not.
    expect(plan.procurementReset).toMatchObject({ stepCodes: ["2F"], fullReset: false });

    await revertStep(twoD2.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    // The reverted step reopens for rework; everything after it resets.
    expect((await getStep(project.id, "2D2")).status).toBe("in_progress");
    for (const code of ["2F", "3A", "3C1"]) {
      expect((await getStep(project.id, code)).status).toBe("not_started");
    }
    // Earlier lifecycle stages survive: only the QC checks were after 2D2.
    const items = await getProcurementItems(project.id);
    for (const item of items) {
      expect(item.qcChecked).toBe(false);
      expect(item.requirementCreatedAt).not.toBeNull();
      expect(item.actualArrivalDate).not.toBeNull();
    }
    // 2F is no longer complete, so phase 3 is locked again and carries no schedule.
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");
    expect((await getStep(project.id, "3A")).plannedEndDate).toBeNull();
    // Steps before 2D2 are untouched.
    expect((await getStep(project.id, "2A")).status).toBe("completed");
    expect((await getStep(project.id, "2D1")).status).toBe("completed");
  });
});

describe("the cascade keeps the dependency gate honest", () => {
  it("resets downstream completed steps so none is left depending on an incomplete step", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");

    const oneB = await getStep(project.id, "1B");
    const plan = await planStepRevert(oneB.id);
    expect(plan.cascade.map((s) => s.stepCode).sort()).toEqual(["1C", "1D"]);

    await revertStep(oneB.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    expect((await getStep(project.id, "1B")).status).toBe("in_progress");
    expect((await getStep(project.id, "1C")).status).toBe("not_started");
    expect((await getStep(project.id, "1D")).status).toBe("not_started");

    // The invariant the cascade exists to protect: nothing completed sits on an open dependency.
    const oneD = await getStep(project.id, "1D");
    expect((await checkDependencyGate(oneD.id)).allowed).toBe(false);
  });

  it("logs every cascaded step, not just the one that was reverted", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");

    const oneB = await getStep(project.id, "1B");
    await revertStep(oneB.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    const oneC = await getStep(project.id, "1C");
    const logs = await getStatusLogs(oneC.id);
    expect(logs.at(-1)!.reason).toContain("Reverted with upstream 1B");
  });
});

describe("reverting a phase gate walks the project back without destroying the phase", () => {
  it("moves current_phase back to phase_1 but keeps the phase 2 rows", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");

    const oneD = await getStep(project.id, "1D");
    const plan = await planStepRevert(oneD.id);
    expect(plan.phaseChange).toEqual({ from: "phase_2", to: "phase_1" });

    await revertStep(oneD.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    expect((await getProject(project.id)).currentPhase).toBe("phase_1");
    expect(await findStep(project.id, "2A")).not.toBeNull();
    expect(await getProcurementItems(project.id)).toHaveLength(3);
  });

  it("re-completing the gate does not duplicate the phase it already seeded", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");

    const oneD = await getStep(project.id, "1D");
    await revertStep(oneD.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });
    await updateStepStatus(oneD.id, "completed", users.accounts);

    const phase2 = await prisma.phaseStep.findMany({ where: { projectId: project.id, phase: "phase_2" } });
    expect(phase2).toHaveLength(4);
    expect(await getProcurementItems(project.id)).toHaveLength(3);
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");
  });

  it("reverting 3E un-completes the project", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await advanceThroughPhase2(project.id, users);

    for (const code of ["3A", "3B", "3C1", "3C2", "3E"]) {
      const step = await getStep(project.id, code);
      await updateStepStatus(step.id, "completed", users.owner_admin);
    }

    const done = await getProject(project.id);
    expect(done.currentPhase).toBe("completed");
    expect(done.overallStatus).toBe("completed");
    expect(done.actualEndDate).not.toBeNull();

    const threeE = await getStep(project.id, "3E");
    await revertStep(threeE.id, users.owner_admin, { reason: REASON });

    const reopened = await getProject(project.id);
    expect(reopened.currentPhase).toBe("phase_3");
    expect(reopened.overallStatus).toBe("on_track");
    expect(reopened.actualEndDate).toBeNull();
  });
});

describe("reverting a derived step clears the procurement data it derives from", () => {
  it("2A resets the three items all the way back to empty", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await advanceThroughPhase2(project.id, users);
    await prisma.procurementItem.updateMany({
      where: { projectId: project.id },
      data: {
        quoteCreatedAt: new Date(),
        orderConfirmedAt: new Date(),
        paymentSettledAt: new Date(),
        paymentDetails: "NEFT ref 12345",
        notes: "ordered from the usual vendor",
      },
    });

    const twoA = await getStep(project.id, "2A");
    expect(twoA.status).toBe("completed");

    const plan = await planStepRevert(twoA.id);
    expect(plan.toStatus).toBe("not_started");
    expect(plan.procurementReset).toMatchObject({ fullReset: true, stepCodes: ["2A", "2D1", "2F"] });

    await revertStep(twoA.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    // Every field is back to the state createEmptyProcurementItemsForProject leaves them in,
    // and the rows themselves survive — 2A derives its status from their existence.
    const items = await getProcurementItems(project.id);
    expect(items).toHaveLength(3);
    for (const item of items) {
      expect(item.requirementCreatedAt).toBeNull();
      expect(item.expectedArrivalDate).toBeNull();
      expect(item.quoteCreatedAt).toBeNull();
      expect(item.orderConfirmedAt).toBeNull();
      expect(item.paymentSettledAt).toBeNull();
      expect(item.paymentDetails).toBeNull();
      expect(item.actualArrivalDate).toBeNull();
      expect(item.qcChecked).toBe(false);
      expect(item.qcCheckedAt).toBeNull();
      expect(item.qcCheckedBy).toBeNull();
      expect(item.notes).toBeNull();
    }

    for (const code of ["2A", "2D1", "2F", "3A", "3E"]) {
      expect((await getStep(project.id, code)).status).toBe("not_started");
    }
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");
    expect((await getStep(project.id, "1D")).status).toBe("completed"); // upstream untouched
  });

  it("records the human reason on 2A, not just the auto-derived line", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await markAllRequirementsCreated(project.id, users.design_engineer);

    const twoA = await getStep(project.id, "2A");
    await revertStep(twoA.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    const logs = await getStatusLogs(twoA.id);
    expect(logs.at(-1)!.reason).toContain(REASON);
    expect(logs.at(-1)!.changedByUserId).toBe(users.owner_admin);
  });

  it("refuses a derived revert without the opt-in, leaving the procurement data intact", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await markAllRequirementsCreated(project.id, users.design_engineer);

    const twoA = await getStep(project.id, "2A");
    await expect(revertStep(twoA.id, users.owner_admin, { reason: REASON })).rejects.toMatchObject({
      status: 409,
      detail: { needsConfirmation: "clearDerivedProcurement" },
    });

    expect((await getStep(project.id, "2A")).status).toBe("completed");
    expect((await getProcurementItems(project.id)).every((i) => i.requirementCreatedAt !== null)).toBe(true);
  });

  it("2F clears only QC, leaving the earlier lifecycle stages alone", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await advanceThroughPhase2(project.id, users);

    const twoF = await getStep(project.id, "2F");
    const plan = await planStepRevert(twoF.id);
    expect(plan.procurementReset).toMatchObject({ fullReset: false, stepCodes: ["2F"] });

    await revertStep(twoF.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    const items = await getProcurementItems(project.id);
    for (const item of items) {
      expect(item.qcChecked).toBe(false);
      expect(item.qcCheckedAt).toBeNull();
      // Requirement and arrival are earlier in the lifecycle, so they stay.
      expect(item.requirementCreatedAt).not.toBeNull();
      expect(item.actualArrivalDate).not.toBeNull();
    }
    expect((await getStep(project.id, "2F")).status).toBe("not_started");
    expect((await getStep(project.id, "2A")).status).toBe("completed");
    expect((await getStep(project.id, "2D1")).status).toBe("completed");
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");
  });

  it("rejects asking a derived step to reopen as in_progress", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await markAllRequirementsCreated(project.id, users.design_engineer);

    const twoA = await getStep(project.id, "2A");
    await expect(
      revertStep(twoA.id, users.owner_admin, {
        reason: REASON,
        toStatus: "in_progress",
        clearDerivedProcurement: true,
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an upstream revert while a derived step downstream holds data, unless told to clear it", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await markAllRequirementsCreated(project.id, users.design_engineer);

    const oneD = await getStep(project.id, "1D");
    const plan = await planStepRevert(oneD.id);
    expect(plan.procurementReset?.stepCodes).toContain("2A");

    await expect(revertStep(oneD.id, users.owner_admin, { reason: REASON })).rejects.toMatchObject({
      status: 409,
      detail: { needsConfirmation: "clearDerivedProcurement" },
    });

    // Nothing was written — the requirement dates the user never agreed to discard are intact.
    expect((await getStep(project.id, "1D")).status).toBe("completed");
    const items = await getProcurementItems(project.id);
    expect(items.every((i) => i.requirementCreatedAt !== null)).toBe(true);
  });

  it("clears the derived sources and goes through when clearDerivedProcurement is set", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await advanceThroughPhase2(project.id, users);

    // Give the items quote/order/payment data too — a status correction must not erase these.
    await prisma.procurementItem.updateMany({
      where: { projectId: project.id },
      data: {
        quoteCreatedAt: new Date(),
        orderConfirmedAt: new Date(),
        paymentSettledAt: new Date(),
        paymentDetails: "paid in full by NEFT",
      },
    });

    const oneD = await getStep(project.id, "1D");
    await revertStep(oneD.id, users.owner_admin, { reason: REASON, clearDerivedProcurement: true });

    expect((await getStep(project.id, "1D")).status).toBe("in_progress");
    for (const code of ["2A", "2D1", "2F", "2D2", "3A", "3E"]) {
      expect((await getStep(project.id, code)).status).toBe("not_started");
    }
    expect((await getProject(project.id)).currentPhase).toBe("phase_1");

    // Reverting 1D reaches back to 2A, the earliest lifecycle stage, so the items go to empty.
    const items = await getProcurementItems(project.id);
    for (const item of items) {
      expect(item.requirementCreatedAt).toBeNull();
      expect(item.expectedArrivalDate).toBeNull();
      expect(item.actualArrivalDate).toBeNull();
      expect(item.qcChecked).toBe(false);
      expect(item.qcCheckedAt).toBeNull();
      expect(item.quoteCreatedAt).toBeNull();
      expect(item.orderConfirmedAt).toBeNull();
      expect(item.paymentSettledAt).toBeNull();
      expect(item.paymentDetails).toBeNull();
    }
  });

  it("names the blocked derived steps in workflow order, with what each one clears", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await advanceThroughPhase2(project.id, users);

    // Complete a manual step in each of phase 2 and 3, so the cascade spans phases and its
    // ordering is worth asserting. advanceThroughPhase2 leaves both at not_started.
    for (const code of ["2D2", "3A"]) {
      const step = await getStep(project.id, code);
      await updateStepStatus(step.id, "completed", users.owner_admin);
    }

    const oneC = await getStep(project.id, "1C");
    const plan = await planStepRevert(oneC.id);

    expect(plan.procurementReset).toEqual({
      stepCodes: ["2A", "2D1", "2F"],
      clears: [
        "requirement dates",
        "quote dates",
        "payment records",
        "order confirmations",
        "arrival dates",
        "QC checks",
      ],
      fullReset: true,
      fromStage: 0,
    });
    // Workflow order, not the row order the query happened to return.
    expect(plan.cascade.map((s) => s.stepCode)).toEqual(["1D", "2D2", "3A"]);
  });

  it("unchecking QC walks 2F back and resets the phase 3 steps it had unlocked", async () => {
    const project = await createTestProject();
    await advanceThroughPhase1(project.id, users, "emergency");
    await advanceThroughPhase2(project.id, users);

    expect((await getStep(project.id, "2F")).status).toBe("completed");
    const threeA = await getStep(project.id, "3A");
    await updateStepStatus(threeA.id, "completed", users.purchase);

    await patchProcurementItem(project.id, "gasket", users.purchase, { qcCheckedAt: null });

    const twoF = await getStep(project.id, "2F");
    expect(twoF.status).toBe("in_progress");
    expect(twoF.actualEndDate).toBeNull();
    expect((await getStep(project.id, "3A")).status).toBe("not_started");
    expect((await getProject(project.id)).currentPhase).toBe("phase_2");

    // Phase 3's rows survive the unwind, so re-checking QC restores the phase rather than re-seeding it.
    await patchProcurementItem(project.id, "gasket", users.purchase, { qcCheckedAt: new Date() });
    expect((await getStep(project.id, "2F")).status).toBe("completed");
    expect(
      await prisma.phaseStep.count({ where: { projectId: project.id, phase: "phase_3" } })
    ).toBe(5);
    expect((await getProject(project.id)).currentPhase).toBe("phase_3");
  });
});
