import { NextRequest, NextResponse } from "next/server";
import {
  adminSessionCookieName,
  adminSessionMaxAge,
  createAdminSessionValue,
  isAuthorizedAdmin,
  verifyDashboardPassword,
} from "@/lib/security/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return NextResponse.json({ authenticated: isAuthorizedAdmin(request) });
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const password = body && typeof body === "object" ? (body as { password?: unknown }).password : undefined;
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || !process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: "Dashboard authentication is not configured" }, { status: 503 });
  }
  if (typeof password !== "string" || password.length > 512 || !verifyDashboardPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(adminSessionCookieName(), createAdminSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: adminSessionMaxAge(),
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(adminSessionCookieName(), "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "strict", path: "/", maxAge: 0,
  });
  return response;
}
