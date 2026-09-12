import { describe, it, expect, afterAll } from "vitest";
import { prisma, TEST_PREFIX } from "../helpers/db";
import { isClientInUseError } from "@/lib/clients";

/**
 * Regression coverage for a live bug: deleting a client that still has a project attached 500'd
 * in production instead of returning the route's own 409. Postgres raises SQLSTATE 23001
 * ("restrict_violation") for an ON DELETE RESTRICT violation — not 23503 like a plain FK
 * violation — so Prisma hands it back as a PrismaClientUnknownRequestError, which the route's
 * original `error.code === "P2003"` check never matched. These tests hit the real constraint
 * (not a mock) so a fix that only recognizes P2003 fails here the same way it failed in prod.
 */
describe("client delete — RESTRICT constraint handling", () => {
  const clientIds: string[] = [];

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
    for (const id of clientIds) {
      await prisma.client.delete({ where: { id } }).catch(() => {});
    }
  });

  it("a client with an attached project can't be deleted, and the error is recognized as in-use", async () => {
    const client = await prisma.client.create({
      data: { name: `${TEST_PREFIX}client-in-use`, phone: "0000000000", address: "N/A" },
    });
    clientIds.push(client.id);
    await prisma.project.create({
      data: {
        name: `${TEST_PREFIX}Project for client-in-use test`,
        clientId: client.id,
        finalCost: 1000,
        glassType: "normal",
      },
    });

    await expect(prisma.client.delete({ where: { id: client.id } })).rejects.toSatisfy((error: unknown) =>
      isClientInUseError(error)
    );
  });

  it("a client with an attached service can't be deleted either", async () => {
    const client = await prisma.client.create({
      data: { name: `${TEST_PREFIX}client-in-use-service`, phone: "0000000000", address: "N/A" },
    });
    clientIds.push(client.id);
    const service = await prisma.service.create({
      data: { title: `${TEST_PREFIX}Service for client-in-use test`, clientId: client.id },
    });

    await expect(prisma.client.delete({ where: { id: client.id } })).rejects.toSatisfy((error: unknown) =>
      isClientInUseError(error)
    );

    await prisma.service.delete({ where: { id: service.id } });
  });

  it("a client with nothing attached deletes cleanly", async () => {
    const client = await prisma.client.create({
      data: { name: `${TEST_PREFIX}client-unattached`, phone: "0000000000", address: "N/A" },
    });
    await expect(prisma.client.delete({ where: { id: client.id } })).resolves.toMatchObject({ id: client.id });
  });
});
