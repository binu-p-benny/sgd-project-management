import { NextResponse } from "next/server";
import { CLIENT_SESSION_COOKIE_NAME } from "@/lib/client-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(CLIENT_SESSION_COOKIE_NAME);
  return response;
}
