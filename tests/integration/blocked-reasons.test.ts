import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { updateStepStatus } from "@/lib/step-actions";
import { BLOCKED_REASON_OPTIONS } from "@/lib/labels";
import { createTestProject, ensureTestUsers, getStep, cleanupTestProjects } from "../helpers/db";
import type { Department } from "@prisma/client";

let users: Record<Department, string>;

beforeAll(async () => {
  users = await ensureTestUsers();
});

afterAll(async () => {
  await cleanupTestProjects();
});

describe("blocked_reason validation", () => {
  it("rejects blocking a step with no blockedReason", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await expect(
      updateStepStatus(oneA.id, "blocked", users.hr_admin)
    ).rejects.toMatchObject({ status: 400 });
  });

  it("'other' requires a blockedNote", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await expect(
      updateStepStatus(oneA.id, "blocked", users.hr_admin, { blockedReason: "other" })
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      updateStepStatus(oneA.id, "blocked", users.hr_admin, { blockedReason: "other", blockedNote: "  " })
    ).rejects.toMatchObject({ status: 400 }); // whitespace-only note doesn't count
  });

  it("'other' with a real note succeeds and stores the note", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "blocked", users.hr_admin, {
      blockedReason: "other",
      blockedNote: "Client asked us to pause for a week",
    });
    const step = await getStep(project.id, "1A");
    expect(step.blockedReason).toBe("other");
    expect(step.blockedNote).toBe("Client asked us to pause for a week");
  });

  it("every one of the 24 blocked_reason values is a valid, distinct reason to block any step", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");

    expect(BLOCKED_REASON_OPTIONS).toHaveLength(24);

    for (const reason of BLOCKED_REASON_OPTIONS) {
      await updateStepStatus(oneA.id, "blocked", users.hr_admin, {
        blockedReason: reason,
        blockedNote: reason === "other" ? "custom reason text" : undefined,
      });
      const step = await getStep(project.id, "1A");
      expect(step.status).toBe("blocked");
      expect(step.blockedReason).toBe(reason);
    }
  });

  it("the picker is one flat list, not filtered per step — a glass-related reason works fine on a phase-1 step", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A"); // phase-1, nothing to do with glass
    await updateStepStatus(oneA.id, "blocked", users.hr_admin, { blockedReason: "glass_damage" });
    const step = await getStep(project.id, "1A");
    expect(step.status).toBe("blocked");
    expect(step.blockedReason).toBe("glass_damage");
  });

  it("client_payment_hold and client_hold remain two separate, independently selectable reasons", async () => {
    const projectA = await createTestProject();
    const projectB = await createTestProject();
    const stepA = await getStep(projectA.id, "1D");
    const stepB = await getStep(projectB.id, "1D");

    await updateStepStatus(stepA.id, "blocked", users.accounts, { blockedReason: "client_payment_hold" });
    await updateStepStatus(stepB.id, "blocked", users.accounts, { blockedReason: "client_hold" });

    expect((await getStep(projectA.id, "1D")).blockedReason).toBe("client_payment_hold");
    expect((await getStep(projectB.id, "1D")).blockedReason).toBe("client_hold");
  });

  it("unblocking a step (moving it to another status) clears blockedReason/blockedNote", async () => {
    const project = await createTestProject();
    const oneA = await getStep(project.id, "1A");
    await updateStepStatus(oneA.id, "blocked", users.hr_admin, {
      blockedReason: "other",
      blockedNote: "temporary",
    });
    await updateStepStatus(oneA.id, "in_progress", users.hr_admin);

    const step = await getStep(project.id, "1A");
    expect(step.status).toBe("in_progress");
    expect(step.blockedReason).toBeNull();
    expect(step.blockedNote).toBeNull();
  });
});
