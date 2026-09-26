import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { clientSessionCookieOptions, CLIENT_SESSION_COOKIE_NAME, normalizePhone, signClientSession } from "@/lib/client-auth";
import { findPortalClients } from "@/lib/client-portal";

const loginSchema = z.object({
  phone: z.string().min(1),
  password: z.string().min(1),
});

/**
 * The portal password is derived from information a client's acquaintances plausibly know (the
 * start of their name and their phone number), so the usual defence — a strong secret — isn't
 * available here. This at least stops someone working through the possibilities in bulk: a
 * handful of tries per number per window, counted in memory.
 *
 * In memory means per server instance, so on Vercel this is a speed bump rather than a lock.
 * Anything stronger needs shared state (a Redis/Upstash counter, or a row per attempt).
 */
const MAX_ATTEMPTS = 8;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; firstAt: number }>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const entry = attempts.get(key);
  if (!entry || now - entry.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS;
}

function clearAttempts(key: string) {
  attempts.delete(key);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter your phone number and password" }, { status: 400 });
  }

  const { phone, password } = parsed.data;
  const key = normalizePhone(phone) || request.headers.get("x-forwarded-for") || "unknown";

  if (rateLimited(key)) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait a few minutes and try again." },
      { status: 429 }
    );
  }

  const matches = await findPortalClients(phone, password);
  if (matches.length === 0) {
    // One message for "no such number" and "wrong password" alike — saying which is wrong would
    // confirm whether a number belongs to a client of SGD's.
    return NextResponse.json({ error: "We couldn't match that phone number and password." }, { status: 401 });
  }

  clearAttempts(key);

  const token = await signClientSession({
    clientIds: matches.map((c) => c.id),
    name: matches[0].name,
    phone: normalizePhone(phone),
  });

  const response = NextResponse.json({ name: matches[0].name, clients: matches.length });
  response.cookies.set(CLIENT_SESSION_COOKIE_NAME, token, clientSessionCookieOptions);
  return response;
}
