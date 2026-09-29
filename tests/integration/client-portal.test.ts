import { describe, it, expect, afterAll } from "vitest";
import { findPortalClients, getPortalProjects } from "@/lib/client-portal";
import { derivePortalPassword } from "@/lib/client-auth";
import { prisma, TEST_PREFIX, cleanupTestProjects } from "../helpers/db";

const createdClientIds: string[] = [];

/**
 * The marker goes on the end of the name, not the front: the portal password is built from the
 * first 3 characters, so a prefix would make every test client's password identical.
 */
async function makeClient(name: string, phone: string) {
  const client = await prisma.client.create({
    data: { name: `${name} ${TEST_PREFIX}`, phone, address: "Test address" },
  });
  createdClientIds.push(client.id);
  return client;
}

async function makeProject(clientId: string, name: string, createdAt?: Date) {
  const project = await prisma.project.create({
    data: {
      name: `${TEST_PREFIX}${name}`,
      clientId,
      finalCost: 100000,
      glassType: "normal",
      currentPhase: "phase_1",
      ...(createdAt ? { createdAt } : {}),
    },
  });
  await prisma.phaseStep.createMany({
    data: [
      {
        projectId: project.id,
        phase: "phase_1",
        stepCode: "1A",
        stepName: "Welcome call + WhatsApp group + visit urgency decision",
        owningDepartment: "hr_admin",
        secondaryDepartment: "project_engineer",
        dependsOn: [],
        status: "completed",
        actualEndDate: new Date(),
        blockedNote: "internal only",
      },
      {
        projectId: project.id,
        phase: "phase_1",
        stepCode: "1B",
        stepName: "Site visit",
        owningDepartment: "design_engineer",
        dependsOn: ["1A"],
        status: "blocked",
        blockedReason: "site_not_ready",
        blockedNote: "client has not cleared the site",
      },
    ],
  });
  return project;
}

afterAll(async () => {
  await cleanupTestProjects();
  await prisma.client.deleteMany({ where: { id: { in: createdClientIds } } });
});

describe("findPortalClients", () => {
  it("matches on the phone number and the derived password", async () => {
    const client = await makeClient("PORTAL ONE", "9990000001");
    const password = derivePortalPassword(client.name, client.phone)!;

    const matched = await findPortalClients("9990000001", password);
    expect(matched.map((c) => c.id)).toContain(client.id);
  });

  it("accepts the number in any shape the client types it", async () => {
    const client = await makeClient("PORTAL TWO", "9990000002");
    const password = derivePortalPassword(client.name, client.phone)!;

    const matched = await findPortalClients("+91 99900 00002", password);
    expect(matched.map((c) => c.id)).toContain(client.id);
  });

  it("returns nothing for the wrong password", async () => {
    const client = await makeClient("PORTAL THREE", "9990000003");
    const matched = await findPortalClients("9990000003", "XXX0000");
    expect(matched.map((c) => c.id)).not.toContain(client.id);
  });

  it("separates two clients who share a phone number by their name prefix", async () => {
    const alpha = await makeClient("ALPHAONE", "9990000004");
    const beta = await makeClient("BETAONE", "9990000004");

    const alphaMatches = await findPortalClients("9990000004", derivePortalPassword(alpha.name, alpha.phone)!);
    const alphaIds = alphaMatches.map((c) => c.id);
    expect(alphaIds).toContain(alpha.id);
    expect(alphaIds).not.toContain(beta.id);
  });

  it("returns both when a shared phone and a shared name prefix make them indistinguishable", async () => {
    // The live data really does have this: "JAISAL" and "JAISAL AREEKODE" on one number.
    const short = await makeClient("JAISALX", "9990000005");
    const long = await makeClient("JAISALX AREEKODE", "9990000005");

    const matched = await findPortalClients("9990000005", derivePortalPassword(short.name, short.phone)!);
    const ids = matched.map((c) => c.id);
    expect(ids).toContain(short.id);
    expect(ids).toContain(long.id);
  });

  it("never matches a client whose record can't produce a password", async () => {
    const client = await makeClient("JUNK PHONE", "ASDSAD");
    const matched = await findPortalClients("ASDSAD", "JUN0000");
    expect(matched.map((c) => c.id)).not.toContain(client.id);
  });
});

describe("getPortalProjects", () => {
  it("returns only the given clients' projects, newest first", async () => {
    const mine = await makeClient("PORTAL OWNER", "9990000010");
    const other = await makeClient("PORTAL STRANGER", "9990000011");
    const older = await makeProject(mine.id, "Older project", new Date(Date.now() - 86_400_000 * 10));
    const newer = await makeProject(mine.id, "Newer project");
    const notMine = await makeProject(other.id, "Someone else's project");

    const projects = await getPortalProjects([mine.id]);
    const ids = projects.map((p) => p.id);

    expect(ids).toEqual([newer.id, older.id]);
    expect(ids).not.toContain(notMine.id);
  });

  it("merges the projects of every client id on the session", async () => {
    const a = await makeClient("PORTAL MERGE A", "9990000012");
    const b = await makeClient("PORTAL MERGE B", "9990000012");
    const fromA = await makeProject(a.id, "From A");
    const fromB = await makeProject(b.id, "From B");

    const ids = (await getPortalProjects([a.id, b.id])).map((p) => p.id);
    expect(ids).toContain(fromA.id);
    expect(ids).toContain(fromB.id);
  });

  it("reports progress from the project's own step count", async () => {
    const client = await makeClient("PORTAL PROGRESS", "9990000013");
    await makeProject(client.id, "Half done");

    const [project] = await getPortalProjects([client.id]);
    expect(project.totalSteps).toBe(2);
    expect(project.completedSteps).toBe(1);
    expect(project.percentComplete).toBe(50);
    expect(project.isComplete).toBe(false);
  });

  it("carries no internal fields on the steps it returns", async () => {
    const client = await makeClient("PORTAL PRIVACY", "9990000014");
    await makeProject(client.id, "Private");

    const [project] = await getPortalProjects([client.id]);
    const blocked = project.steps.find((s) => s.status === "blocked")!;

    // The step is blocked, and the client is told only that — not why, and not the note.
    expect(blocked).toBeDefined();
    expect(JSON.stringify(project)).not.toContain("site_not_ready");
    expect(JSON.stringify(project)).not.toContain("client has not cleared the site");
    expect(JSON.stringify(project)).not.toContain("internal only");
    expect(Object.keys(blocked).sort()).toEqual(
      ["actualEndDate", "id", "phase", "plannedEndDate", "plannedStartDate", "status", "stepCode", "stepName"].sort()
    );
  });

  it("returns nothing for a session with no client ids", async () => {
    expect(await getPortalProjects([])).toEqual([]);
  });
});

describe("phases a project hasn't reached yet", () => {
  it("still shows Installation, as planned steps with no dates", async () => {
    const client = await makeClient("PORTAL PHASES", "9990000020");
    await makeProject(client.id, "Early days");

    const [project] = await getPortalProjects([client.id]);
    const phases = new Set(project.steps.map((s) => s.phase));
    expect(phases.has("phase_3")).toBe(true);

    const phase3 = project.steps.filter((s) => s.phase === "phase_3");
    expect(phase3.map((s) => s.stepCode)).toEqual(["3A", "3B", "3C1", "3C2", "3E"]);
    expect(phase3.every((s) => s.status === "not_started")).toBe(true);
    // Nothing has been planned for them yet, so they carry no dates to promise.
    expect(phase3.every((s) => !s.plannedStartDate && !s.plannedEndDate && !s.actualEndDate)).toBe(true);
  });

  it("does not let those planned steps change how far along the project looks", async () => {
    const client = await makeClient("PORTAL PERCENT", "9990000021");
    await makeProject(client.id, "Half done");

    const [project] = await getPortalProjects([client.id]);
    // The project has two real steps, one of them complete — the Phase 2 and 3 placeholders
    // appended for display must not count against it.
    expect(project.totalSteps).toBe(2);
    expect(project.completedSteps).toBe(1);
    expect(project.percentComplete).toBe(50);
    expect(project.steps.length).toBeGreaterThan(2);
  });

  it("leaves a real phase alone", async () => {
    const client = await makeClient("PORTAL REAL", "9990000022");
    await makeProject(client.id, "Has real steps");

    const [portal] = await getPortalProjects([client.id]);
    const phase1 = portal.steps.filter((s) => s.phase === "phase_1");
    // The two seeded rows, not the four-step template.
    expect(phase1).toHaveLength(2);
    expect(phase1.every((s) => !s.id.startsWith("planned:"))).toBe(true);
  });
});

describe("the material chain (Phase 2)", () => {
  function materialChain(steps: Awaited<ReturnType<typeof getPortalProjects>>[number]["steps"]) {
    return {
      order: steps.find((s) => s.id === "material:order_confirmed")!,
      dispatched: steps.find((s) => s.id === "material:dispatched")!,
      powderCoating: steps.find((s) => s.id === "material:powder_coating")!,
      arrived: steps.find((s) => s.id === "material:arrived")!,
    };
  }

  async function makeSectionItem(projectId: string, data: Partial<Parameters<typeof prisma.procurementItem.create>[0]["data"]>) {
    return prisma.procurementItem.create({ data: { projectId, itemType: "section", ...data } });
  }

  it("shows every stage as not started before the project reaches Phase 2", async () => {
    const client = await makeClient("PORTAL CHAIN NONE", "9990000030");
    const project = await makeProject(client.id, "No procurement yet");

    const [portal] = await getPortalProjects([client.id]);
    const chain = materialChain(portal.steps);
    expect(chain.order.status).toBe("not_started");
    expect(chain.dispatched.status).toBe("not_started");
    expect(chain.powderCoating.status).toBe("not_started");
    expect(chain.arrived.status).toBe("not_started");
    expect(chain.order.gapCaption).toBeFalsy();
    void project;
  });

  it("moves order confirmed to in progress once procurement items exist", async () => {
    const client = await makeClient("PORTAL CHAIN STARTED", "9990000031");
    const project = await makeProject(client.id, "Procurement started");
    await makeSectionItem(project.id, {});
    await prisma.procurementItem.create({ data: { projectId: project.id, itemType: "hardware" } });
    await prisma.procurementItem.create({ data: { projectId: project.id, itemType: "gasket" } });

    const [portal] = await getPortalProjects([client.id]);
    const chain = materialChain(portal.steps);
    expect(chain.order.status).toBe("in_progress");
    expect(chain.dispatched.status).toBe("not_started");
  });

  it("shows 'production ongoing' between order confirmed and dispatch when on time", async () => {
    const client = await makeClient("PORTAL CHAIN ONTIME", "9990000032");
    const project = await makeProject(client.id, "On time order");
    await makeSectionItem(project.id, { orderConfirmedAt: new Date() });

    const [portal] = await getPortalProjects([client.id]);
    const chain = materialChain(portal.steps);
    expect(chain.order.status).toBe("completed");
    expect(chain.dispatched.status).toBe("in_progress");
    expect(chain.order.gapCaption).toBe("Production ongoing");
    expect(chain.order.gapDelayed).toBe(false);
  });

  it("shows 'production delayed' once dispatch is overdue", async () => {
    const client = await makeClient("PORTAL CHAIN LATE", "9990000033");
    const project = await makeProject(client.id, "Late order");
    // 7 working days have long since passed.
    await makeSectionItem(project.id, { orderConfirmedAt: new Date(Date.now() - 20 * 86_400_000) });

    const [portal] = await getPortalProjects([client.id]);
    const chain = materialChain(portal.steps);
    expect(chain.order.gapCaption).toBe("Production delayed");
    expect(chain.order.gapDelayed).toBe(true);
  });

  it("shows the in-transit caption once material has dispatched", async () => {
    const client = await makeClient("PORTAL CHAIN TRANSIT", "9990000034");
    const project = await makeProject(client.id, "In transit");
    await makeSectionItem(project.id, {
      orderConfirmedAt: new Date(Date.now() - 10 * 86_400_000),
      materialDespatchAt: new Date(),
    });

    const [portal] = await getPortalProjects([client.id]);
    const chain = materialChain(portal.steps);
    expect(chain.dispatched.status).toBe("completed");
    expect(chain.powderCoating.status).toBe("in_progress");
    expect(chain.dispatched.gapCaption).toBe("In transit — material dispatched");
    expect(chain.dispatched.gapDelayed).toBe(false);
  });

  it("completes the chain once every item has arrived", async () => {
    const client = await makeClient("PORTAL CHAIN DONE", "9990000035");
    const project = await makeProject(client.id, "All arrived");
    const arrivedAt = new Date();
    await makeSectionItem(project.id, {
      orderConfirmedAt: new Date(Date.now() - 30 * 86_400_000),
      materialDespatchAt: new Date(Date.now() - 20 * 86_400_000),
      arrivedForPowderCoatingAt: new Date(Date.now() - 10 * 86_400_000),
      actualArrivalDate: arrivedAt,
    });
    await prisma.procurementItem.create({
      data: { projectId: project.id, itemType: "hardware", actualArrivalDate: arrivedAt },
    });
    await prisma.procurementItem.create({
      data: { projectId: project.id, itemType: "gasket", actualArrivalDate: arrivedAt },
    });

    const [portal] = await getPortalProjects([client.id]);
    const chain = materialChain(portal.steps);
    expect(chain.powderCoating.status).toBe("completed");
    expect(chain.arrived.status).toBe("completed");
    expect(chain.powderCoating.gapCaption).toBeFalsy();
  });

  it("doesn't count materials arrived until hardware and gasket have too", async () => {
    const client = await makeClient("PORTAL CHAIN PARTIAL", "9990000036");
    const project = await makeProject(client.id, "Section only arrived");
    await makeSectionItem(project.id, {
      orderConfirmedAt: new Date(Date.now() - 30 * 86_400_000),
      materialDespatchAt: new Date(Date.now() - 20 * 86_400_000),
      arrivedForPowderCoatingAt: new Date(),
      actualArrivalDate: null,
    });
    await prisma.procurementItem.create({ data: { projectId: project.id, itemType: "hardware" } });
    await prisma.procurementItem.create({ data: { projectId: project.id, itemType: "gasket" } });

    const [portal] = await getPortalProjects([client.id]);
    const chain = materialChain(portal.steps);
    expect(chain.arrived.status).toBe("in_progress");
    expect(chain.powderCoating.gapCaption).toBe("Arrived for powder coating — ongoing");
  });

  it("no longer shows 2A or 2D1, but keeps 2D2 and 2F", async () => {
    const client = await makeClient("PORTAL CHAIN CODES", "9990000037");
    const project = await makeProject(client.id, "Codes check");
    await makeSectionItem(project.id, {});

    const [portal] = await getPortalProjects([client.id]);
    const phase2Codes = portal.steps.filter((s) => s.phase === "phase_2").map((s) => s.stepCode);
    expect(phase2Codes).not.toContain("2A");
    expect(phase2Codes).not.toContain("2D1");
    expect(phase2Codes).toContain("2D2");
    expect(phase2Codes).toContain("2F");
  });
});
