import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { CLIENT_SESSION_COOKIE_NAME, verifyClientSessionToken } from "@/lib/client-auth";

const PUBLIC_PATHS = [
  "/login",
  "/api/auth/login",
  "/api/auth/logout",
  "/portal/login",
  "/api/portal/login",
  "/api/portal/logout",
];

/** Everything under here belongs to the client portal and is gated by the portal cookie alone. */
const PORTAL_PREFIX = "/portal";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((path) => pathname === path)) {
    return NextResponse.next();
  }

  // Checked before the staff session, so a client is never bounced to the staff login — and a
  // staff cookie doesn't open the portal either, since verifyClientSessionToken rejects a
  // payload without clientIds even though both are signed with the same secret.
  if (pathname === PORTAL_PREFIX || pathname.startsWith(`${PORTAL_PREFIX}/`)) {
    const portalToken = request.cookies.get(CLIENT_SESSION_COOKIE_NAME)?.value;
    const portalSession = portalToken ? await verifyClientSessionToken(portalToken) : null;
    if (!portalSession) {
      return NextResponse.redirect(new URL("/portal/login", request.url));
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = token ? await verifySessionToken(token) : null;

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (
    pathname.startsWith("/dashboard") &&
    session.department !== "owner_admin" &&
    session.department !== "operations_manager" &&
    session.department !== "project_engineer"
  ) {
    return NextResponse.redirect(new URL("/my-tasks", request.url));
  }

  if (
    pathname.startsWith("/admin") &&
    session.department !== "owner_admin" &&
    session.department !== "hr_admin" &&
    session.department !== "operations_manager" &&
    session.department !== "project_engineer"
  ) {
    return NextResponse.redirect(new URL("/my-tasks", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
