import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

/**
 * Session handling for the client portal (/portal) — deliberately separate from the staff
 * session in auth.ts: its own cookie name, its own payload shape, and no Department anywhere in
 * it. A portal cookie can therefore never satisfy a staff check, and a staff cookie can never
 * satisfy a portal one, whatever either side is handed.
 *
 * No prisma import here, so this stays usable from the proxy's edge-ish context.
 */

export const CLIENT_SESSION_COOKIE_NAME = "sgd_client_session";
const CLIENT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — clients sign in rarely

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }
  return new TextEncoder().encode(secret);
}

export interface ClientSessionPayload {
  /**
   * Every client record this login resolved to — plural because a phone number is not unique in
   * this data (one number is shared by several client rows, usually the same person entered
   * more than once). The portal shows the projects of all of them; see findPortalClients.
   */
  clientIds: string[];
  /** Whatever the client is called on the record they logged in with — for the greeting only. */
  name: string;
  /** Digits only, as typed. */
  phone: string;
}

/** Digits only — clients type their number with spaces, dashes or a +91 however they please. */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Two numbers are the same number if their digits match outright, or if the last 10 digits do —
 * which is what makes "+91 98765 00002", "9876500002" and "919876500002" one number. Shorter
 * than 10 digits (plenty of the older records are) has to match exactly, since a 3-digit record
 * matching by suffix would collide with half the database.
 */
export function phoneMatches(stored: string, typed: string): boolean {
  const a = normalizePhone(stored);
  const b = normalizePhone(typed);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length >= 10 && b.length >= 10) return a.slice(-10) === b.slice(-10);
  return false;
}

/**
 * The portal password, as specified: the client's first 3 name characters followed by the first
 * 4 digits of their phone number. Nothing is stored — it is derived from the client record on
 * every attempt, so there is no password column to migrate, reset or leak.
 *
 * Spaces are skipped when taking the name characters ("SAM KOLLAM" gives SAM, not "SAM "), and
 * comparison is case-insensitive. Returns null when the record can't produce a 7-character
 * password — a name under 3 characters, or a phone with fewer than 4 digits (13 of the current
 * records have junk phone values like "ASDSAD"). Those clients simply cannot sign in until the
 * record is corrected, which is better than falling back to a shorter, guessable password.
 */
export function derivePortalPassword(name: string, phone: string): string | null {
  const letters = name.replace(/\s+/g, "");
  const digits = normalizePhone(phone);
  if (letters.length < 3 || digits.length < 4) return null;
  return `${letters.slice(0, 3)}${digits.slice(0, 4)}`.toUpperCase();
}

/** Case-insensitive, whitespace-tolerant comparison of a typed password against the derived one. */
export function portalPasswordMatches(name: string, phone: string, typed: string): boolean {
  const expected = derivePortalPassword(name, phone);
  if (!expected) return false;
  return expected === typed.replace(/\s+/g, "").toUpperCase();
}

export async function signClientSession(payload: ClientSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${CLIENT_SESSION_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export async function verifyClientSessionToken(token: string): Promise<ClientSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    // A staff token is signed with the same secret, so verifying isn't enough on its own —
    // only a payload carrying clientIds is a portal session.
    if (!Array.isArray((payload as { clientIds?: unknown }).clientIds)) return null;
    return payload as unknown as ClientSessionPayload;
  } catch {
    return null;
  }
}

/** Reads and verifies the portal cookie. Use in Server Components and Route Handlers. */
export async function getClientSession(): Promise<ClientSessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(CLIENT_SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyClientSessionToken(token);
}

export const clientSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: CLIENT_SESSION_TTL_SECONDS,
};
