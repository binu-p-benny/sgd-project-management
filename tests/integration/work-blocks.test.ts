import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Department } from "@prisma/client";

// Only getSession is faked (there's no request cookie to read in a test) — the real
// isAdminEditor the routes call next to it is exactly what's under test.
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, getSession: vi.fn() };
});

import { getSession } from "@/lib/auth";
import { POST as createBlock } from "@/app/api/projects/[id]/work-blocks/route";
import { DELETE as deleteBlock } from "@/app/api/work-blocks/[id]/route";
import { POST as createTask } from "@/app/api/work-blocks/[id]/tasks/route";
import { PATCH as patchTask } from "@/app/api/work-tasks/[id]/route";
import { createTestProject, ensureTestUsers, cleanupTestProjects, prisma } from "../helpers/db";

let users: Record<Department, string>;
const mockedGetSession = vi.mocked(getSession);
const PLANNED = "2026-10-01T00:00:00.000Z";

beforeAll(async () => {
  users = await ensureTestUsers();
});

beforeEach(() => {
  mockedGetSession.mockReset();
});

afterAll(async () => {
  await cleanupTestProjects();
});

function actAs(department: Department | null) {
  mockedGetSession.mockResolvedValue(
    department
      ? { userId: users[department], email: `${department}@test.local`, name: `Test ${department}`, department }
      : null
  );
}

function jsonRequest(method: string, body?: unknown) {
  return new NextRequest("http://localhost/api/test", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const callCreateBlock = (projectId: string, body: unknown) =>
  createBlock(jsonRequest("POST", body), { params: Promise.resolve({ id: projectId }) });
const callDeleteBlock = (blockId: string) =>
  deleteBlock(jsonRequest("DELETE"), { params: Promise.resolve({ id: blockId }) });
const callCreateTask = (blockId: string, body: unknown) =>
  createTask(jsonRequest("POST", body), { params: Promise.resolve({ id: blockId }) });
const callPatchTask = (taskId: string, body: unknown) =>
  patchTask(jsonRequest("PATCH", body), { params: Promise.resolve({ id: taskId }) });

async function setupBlock() {
  const project = await createTestProject();
  const block = await prisma.workBlock.create({ data: { projectId: project.id, label: "Extra railing" } });
  return { project, block };
}

async function setupTask(overrides: Partial<{ department: Department; isPassFail: boolean }> = {}) {
  const { project, block } = await setupBlock();
  const task = await prisma.workTask.create({
    data: {
      workBlockId: block.id,
      taskLabel: "Measure site",
      department: overrides.department ?? "purchase",
      isPassFail: overrides.isPassFail ?? false,
      plannedDate: new Date(PLANNED),
    },
  });
  return { project, block, task };
}

describe("POST /api/projects/[id]/work-blocks", () => {
  it("creates a block from just a label, trimmed", async () => {
    const project = await createTestProject();
    actAs("owner_admin");

    const response = await callCreateBlock(project.id, { label: "  Extra balcony railing  " });

    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.label).toBe("Extra balcony railing");
    const stored = await prisma.workBlock.findMany({ where: { projectId: project.id } });
    expect(stored.map((b) => b.label)).toEqual(["Extra balcony railing"]);
  });

  it.each(["owner_admin", "operations_manager", "hr_admin"] as Department[])("allows %s", async (department) => {
    const project = await createTestProject();
    actAs(department);

    expect((await callCreateBlock(project.id, { label: "Extra" })).status).toBe(201);
  });

  it.each(["accounts", "project_engineer"] as Department[])("forbids %s and creates nothing", async (department) => {
    const project = await createTestProject();
    actAs(department);

    expect((await callCreateBlock(project.id, { label: "Extra" })).status).toBe(403);
    expect(await prisma.workBlock.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("401s when signed out", async () => {
    const project = await createTestProject();
    actAs(null);

    expect((await callCreateBlock(project.id, { label: "Extra" })).status).toBe(401);
  });

  it("400s on a missing, blank or over-long label", async () => {
    const project = await createTestProject();
    actAs("owner_admin");

    expect((await callCreateBlock(project.id, {})).status).toBe(400);
    expect((await callCreateBlock(project.id, { label: "   " })).status).toBe(400);
    expect((await callCreateBlock(project.id, { label: "x".repeat(121) })).status).toBe(400);
    expect(await prisma.workBlock.count({ where: { projectId: project.id } })).toBe(0);
  });

  it("404s for an unknown project, and for a deleted one", async () => {
    actAs("owner_admin");
    expect((await callCreateBlock("does-not-exist", { label: "Extra" })).status).toBe(404);

    const project = await createTestProject();
    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
    expect((await callCreateBlock(project.id, { label: "Extra" })).status).toBe(404);
  });
});

describe("POST /api/work-blocks/[id]/tasks", () => {
  it("adds a row with its department, planned date and pass/fail opt-in — not done yet", async () => {
    const { block } = await setupBlock();
    actAs("owner_admin");

    const response = await callCreateTask(block.id, {
      taskLabel: "  Fabricate railing  ",
      department: "purchase",
      plannedDate: PLANNED,
      isPassFail: true,
    });

    expect(response.status).toBe(201);
    const stored = await prisma.workTask.findMany({ where: { workBlockId: block.id } });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      taskLabel: "Fabricate railing",
      department: "purchase",
      isPassFail: true,
      actualDate: null,
      qcPassed: null,
      note: null,
    });
    expect(stored[0].plannedDate.toISOString()).toBe(PLANNED);
  });

  it("isPassFail defaults to false, and rows keep their creation order across several adds", async () => {
    const { block } = await setupBlock();
    actAs("owner_admin");

    await callCreateTask(block.id, { taskLabel: "First", department: "purchase", plannedDate: PLANNED });
    await callCreateTask(block.id, { taskLabel: "Second", department: "accounts", plannedDate: PLANNED });

    const stored = await prisma.workTask.findMany({ where: { workBlockId: block.id }, orderBy: { createdAt: "asc" } });
    expect(stored.map((t) => t.taskLabel)).toEqual(["First", "Second"]);
    expect(stored.every((t) => t.isPassFail === false)).toBe(true);
  });

  it("400s without a task, a planned date, or a real assignable department", async () => {
    const { block } = await setupBlock();
    actAs("owner_admin");

    expect((await callCreateTask(block.id, { department: "purchase", plannedDate: PLANNED })).status).toBe(400);
    expect((await callCreateTask(block.id, { taskLabel: "x", department: "purchase" })).status).toBe(400);
    expect((await callCreateTask(block.id, { taskLabel: "x", plannedDate: PLANNED })).status).toBe(400);
    // Not a department at all — same restriction a service's "+ Add row" has.
    expect(
      (await callCreateTask(block.id, { taskLabel: "x", department: "finance", plannedDate: PLANNED })).status
    ).toBe(400);
    expect(await prisma.workTask.count({ where: { workBlockId: block.id } })).toBe(0);
  });

  it("accepts owner_admin and operations_manager as real work-owning departments", async () => {
    const { block } = await setupBlock();
    actAs("owner_admin");

    for (const department of ["owner_admin", "operations_manager"] as const) {
      const response = await callCreateTask(block.id, { taskLabel: `For ${department}`, department, plannedDate: PLANNED });
      expect(response.status).toBe(201);
    }

    const stored = await prisma.workTask.findMany({ where: { workBlockId: block.id } });
    expect(stored.map((t) => t.department).sort()).toEqual(["operations_manager", "owner_admin"]);
  });

  it("forbids non-admin departments, 401s signed out, and 404s an unknown or deleted block", async () => {
    const { block } = await setupBlock();
    const body = { taskLabel: "x", department: "purchase", plannedDate: PLANNED };

    actAs("purchase");
    expect((await callCreateTask(block.id, body)).status).toBe(403);
    actAs(null);
    expect((await callCreateTask(block.id, body)).status).toBe(401);

    actAs("owner_admin");
    expect((await callCreateTask("does-not-exist", body)).status).toBe(404);
    await prisma.workBlock.update({ where: { id: block.id }, data: { deletedAt: new Date() } });
    expect((await callCreateTask(block.id, body)).status).toBe(404);
  });
});

describe("PATCH /api/work-tasks/[id]", () => {
  it("marks a row complete with an actual date and a note", async () => {
    const { task } = await setupTask();
    actAs("owner_admin");

    const response = await callPatchTask(task.id, { actualDate: "2026-10-03T00:00:00.000Z", note: "Done on site" });

    expect(response.status).toBe(200);
    const stored = await prisma.workTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored.actualDate?.toISOString()).toBe("2026-10-03T00:00:00.000Z");
    expect(stored.note).toBe("Done on site");
  });

  it("records a pass/fail outcome, and clearing the actual date reverts it — qcPassed resets too", async () => {
    const { task } = await setupTask({ isPassFail: true });
    actAs("owner_admin");

    await callPatchTask(task.id, { actualDate: "2026-10-03T00:00:00.000Z", qcPassed: false, note: "Cracked" });
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: task.id } })).qcPassed).toBe(false);

    await callPatchTask(task.id, { actualDate: null });
    const reverted = await prisma.workTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(reverted.actualDate).toBeNull();
    expect(reverted.qcPassed).toBeNull();
  });

  it("lets the row's own department correct its own taskLabel and plannedDate", async () => {
    const { task } = await setupTask({ department: "purchase" });
    actAs("purchase");

    const response = await callPatchTask(task.id, {
      taskLabel: "Corrected label",
      plannedDate: "2026-11-05T00:00:00.000Z",
    });

    expect(response.status).toBe(200);
    const stored = await prisma.workTask.findUniqueOrThrow({ where: { id: task.id } });
    expect(stored.taskLabel).toBe("Corrected label");
    expect(stored.plannedDate.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    // department and isPassFail are untouched — this PATCH only ever moves taskLabel/plannedDate.
    expect(stored.department).toBe("purchase");
  });

  it("400s an empty taskLabel", async () => {
    const { task } = await setupTask();
    actAs("owner_admin");
    expect((await callPatchTask(task.id, { taskLabel: "   " })).status).toBe(400);
  });

  it("lets the row's own department update it, but not a different one", async () => {
    const { task } = await setupTask({ department: "purchase" });

    actAs("purchase");
    expect((await callPatchTask(task.id, { note: "on it" })).status).toBe(200);

    actAs("accounts");
    expect((await callPatchTask(task.id, { note: "hijack" })).status).toBe(403);
    expect((await prisma.workTask.findUniqueOrThrow({ where: { id: task.id } })).note).toBe("on it");
  });

  it("lets any admin editor update any department's row", async () => {
    const { task } = await setupTask({ department: "purchase" });

    for (const department of ["owner_admin", "operations_manager", "hr_admin"] as Department[]) {
      actAs(department);
      expect((await callPatchTask(task.id, { note: department })).status).toBe(200);
    }
  });

  it("401s signed out, 404s an unknown row, and 400s a malformed date", async () => {
    const { task } = await setupTask();

    actAs(null);
    expect((await callPatchTask(task.id, { note: "x" })).status).toBe(401);

    actAs("owner_admin");
    expect((await callPatchTask("does-not-exist", { note: "x" })).status).toBe(404);
    expect((await callPatchTask(task.id, { actualDate: "not-a-date" })).status).toBe(400);
  });
});

describe("DELETE /api/work-blocks/[id] — soft delete", () => {
  it("hides the block and its rows everywhere, but keeps them in the database", async () => {
    const { project, block, task } = await setupTask();
    actAs("owner_admin");

    const response = await callDeleteBlock(block.id);

    expect(response.status).toBe(200);
    expect(await prisma.workBlock.findMany({ where: { projectId: project.id } })).toEqual([]);
    expect(await prisma.workTask.findMany({ where: { workBlockId: block.id } })).toEqual([]);
    // Nothing was actually removed: the row is still there, just stamped.
    const raw = await prisma.$queryRaw<{ deleted_at: Date | null }[]>`SELECT deleted_at FROM work_blocks WHERE id = ${block.id}`;
    expect(raw).toHaveLength(1);
    expect(raw[0].deleted_at).not.toBeNull();
    const rawTasks = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM work_tasks WHERE id = ${task.id}`;
    expect(rawTasks).toHaveLength(1);
  });

  it("leaves the project's other blocks alone", async () => {
    const { project, block } = await setupBlock();
    const other = await prisma.workBlock.create({ data: { projectId: project.id, label: "Second block" } });
    actAs("owner_admin");

    await callDeleteBlock(block.id);

    const remaining = await prisma.workBlock.findMany({ where: { projectId: project.id } });
    expect(remaining.map((b) => b.id)).toEqual([other.id]);
  });

  it("forbids non-admin departments, 401s signed out, and 404s an unknown or already-deleted block", async () => {
    const { block } = await setupBlock();

    actAs("accounts");
    expect((await callDeleteBlock(block.id)).status).toBe(403);
    actAs(null);
    expect((await callDeleteBlock(block.id)).status).toBe(401);
    expect(await prisma.workBlock.findUnique({ where: { id: block.id } })).not.toBeNull();

    actAs("operations_manager");
    expect((await callDeleteBlock("does-not-exist")).status).toBe(404);
    expect((await callDeleteBlock(block.id)).status).toBe(200);
    expect((await callDeleteBlock(block.id)).status).toBe(404);
  });
});

describe("a deleted project takes its work blocks and rows with it", () => {
  it("hides them from every read once the project is soft-deleted", async () => {
    const { project, block } = await setupTask();
    expect(await prisma.workBlock.count({ where: { projectId: project.id } })).toBe(1);

    await prisma.project.update({ where: { id: project.id }, data: { deletedAt: new Date() } });

    expect(await prisma.workBlock.findMany({ where: { projectId: project.id } })).toEqual([]);
    expect(await prisma.workTask.findMany({ where: { workBlockId: block.id } })).toEqual([]);
  });
});
