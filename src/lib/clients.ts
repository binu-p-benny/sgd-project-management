import { Prisma } from "@prisma/client";

export const CLIENT_IN_USE_MESSAGE =
  "Can't delete — this client still has a project or service. Remove those first.";

/**
 * True for both shapes Postgres/Prisma can hand back for the client_id RESTRICT relation on
 * Project/Service: a plain FK violation Prisma recognizes (P2003, SQLSTATE 23503) and a
 * RESTRICT-specific violation it doesn't (SQLSTATE 23001, "restrict_violation") — Postgres raises
 * the latter specifically for an ON DELETE RESTRICT action, and Prisma surfaces it as an
 * *unknown* request error instead of a known one, so matching on P2003 alone missed it and fell
 * through to an unhandled 500 (see DELETE /api/clients/[id], where this was first caught).
 */
export function isClientInUseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") return true;
  return (
    error instanceof Prisma.PrismaClientUnknownRequestError &&
    /23001|23503|foreign key constraint/i.test(error.message)
  );
}
