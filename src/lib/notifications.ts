import { prisma } from "@/lib/prisma";
import type { Department } from "@prisma/client";

/**
 * The oversight departments — the same set isAdminEditor in auth.ts encodes. Every kind of
 * notification goes to these three on top of whichever department owns the work, so nothing
 * that stalls is only visible to the department that let it stall.
 */
export const ADMIN_DEPARTMENTS: Department[] = ["owner_admin", "hr_admin", "operations_manager"];

/** "12 Sep" — the date wording every notification message uses for a planned/due date. */
export function formatShortDate(date: Date): string {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(date);
}

export interface NotifyDepartmentsInput {
  /** Free-form kind (see Notification.type) — kept a plain string so a new one needs no migration. */
  type: string;
  message: string;
  /** Owning/secondary departments for the work. Nulls are ignored, duplicates collapse. */
  departments: (Department | null | undefined)[];
  projectId?: string | null;
  phaseStepId?: string | null;
  /**
   * Set for anything a repeating job produces, so re-running it is a no-op (see
   * Notification.dedupeKey). Event-driven kinds leave it null — they already fire exactly once,
   * per action.
   */
  dedupeKey?: string | null;
  /** False keeps a notification inside the owning departments — nothing uses this yet. */
  includeAdmins?: boolean;
  /**
   * The person whose own action triggered this, if any — they don't need telling what they
   * just did. Only meaningful for event-driven kinds; a cron has no actor.
   */
  exceptUserId?: string | null;
}

/** Every user in the given departments (plus the admin ones unless opted out), minus the actor. */
export async function resolveRecipients(
  departments: (Department | null | undefined)[],
  options: { includeAdmins?: boolean; exceptUserId?: string | null } = {}
): Promise<string[]> {
  const set = new Set<Department>();
  for (const d of departments) if (d) set.add(d);
  if (options.includeAdmins !== false) for (const d of ADMIN_DEPARTMENTS) set.add(d);
  if (set.size === 0) return [];

  const users = await prisma.user.findMany({
    where: { department: { in: Array.from(set) } },
    select: { id: true },
  });
  return users.map((u) => u.id).filter((id) => id !== options.exceptUserId);
}

/**
 * Creates one notification per recipient. Returns how many rows were actually written — with a
 * dedupeKey that can be fewer than the recipient count (or zero), since skipDuplicates drops
 * anyone who already holds that exact key.
 */
export async function notifyDepartments(input: NotifyDepartmentsInput): Promise<number> {
  const recipients = await resolveRecipients(input.departments, {
    includeAdmins: input.includeAdmins,
    exceptUserId: input.exceptUserId,
  });
  if (recipients.length === 0) return 0;

  const result = await prisma.notification.createMany({
    data: recipients.map((userId) => ({
      userId,
      type: input.type,
      message: input.message,
      projectId: input.projectId ?? null,
      phaseStepId: input.phaseStepId ?? null,
      dedupeKey: input.dedupeKey ?? null,
    })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Notifications fired from inside a request (a block, a QC failure) are a side effect of the
 * write that triggered them, never the point of it: a notification that fails to write must not
 * turn a successfully recorded block into a 500 for the person who recorded it. Every
 * event-driven caller goes through this.
 */
export async function notifyQuietly(input: NotifyDepartmentsInput): Promise<number> {
  try {
    return await notifyDepartments(input);
  } catch (err) {
    console.error(`[notifications] failed to send "${input.type}"`, err);
    return 0;
  }
}
