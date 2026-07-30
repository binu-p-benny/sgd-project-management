import { PrismaClient } from "@prisma/client";

/**
 * Models that are only ever meaningful inside a project, and the path from each one back to it.
 * Reads on these are filtered by the owning project's deleted_at, so hiding a project hides its
 * steps, its procurement rows and its audit trail along with it.
 */
const PATH_TO_PROJECT: Record<string, object> = {
  Project: { deletedAt: null },
  PhaseStep: { project: { deletedAt: null } },
  ProcurementItem: { project: { deletedAt: null } },
  StepStatusLog: { phaseStep: { project: { deletedAt: null } } },
};

// Reads. Writes are deliberately left alone: a soft-deleted project's rows can still be updated
// by anything holding an id (nothing in the UI offers that, since it can't surface the project
// in the first place), and blocking writes here would mean the delete action itself couldn't
// set deleted_at through this client.
const FILTERED_OPERATIONS = new Set([
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * Applies the soft-delete filter to every read, centrally.
 *
 * Deleting a project is a front-end action — the row and everything hanging off it stay in the
 * database — so "deleted" only means "never shown". That is an invariant across roughly twenty
 * read sites (the projects table, the project and edit pages, /my-tasks, /admin, and every
 * dashboard widget), and a single one forgetting the filter is a visible bug. Enforcing it in the
 * client makes it structural instead of something each new query has to remember.
 *
 * findUnique/findUniqueOrThrow are rewritten to findFirst/findFirstOrThrow, because Prisma only
 * accepts unique fields in a findUnique `where` and the filter for the child models is a relation
 * condition. Looking a row up by its own unique id and getting nothing back when its project is
 * deleted is exactly the intent — a stale link to a deleted project should 404, not resolve.
 */
function withSoftDelete(client: PrismaClient) {
  return client.$extends({
    name: "softDeleteProjects",
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          const filter = model ? PATH_TO_PROJECT[model] : undefined;
          if (!filter) return query(args);

          if (operation === "findUnique" || operation === "findUniqueOrThrow") {
            const rewritten = operation === "findUnique" ? "findFirst" : "findFirstOrThrow";
            const a = args as { where?: object };
            // Cast through one model's delegate: every model here exposes the same
            // findFirst/findFirstOrThrow shape, and the `where` we pass is built above.
            return client[model as "project"][rewritten]({
              ...a,
              where: { ...(a.where ?? {}), ...filter },
            });
          }

          if (FILTERED_OPERATIONS.has(operation)) {
            const a = args as { where?: object };
            return query({ ...a, where: { ...(a.where ?? {}), ...filter } });
          }

          return query(args);
        },
      },
    },
  });
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof withSoftDelete> | undefined;
};

export const prisma = globalForPrisma.prisma ?? withSoftDelete(new PrismaClient());

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
