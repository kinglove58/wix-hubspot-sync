import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { readBoundedBody, RequestBodyError } from "@/lib/security/request-body";
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
  if (request.headers.get("origin") !== new URL(process.env.APP_BASE_URL ?? "http://localhost:3000").origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  let body: unknown;
  try { body = JSON.parse(await readBoundedBody(request, 2048)); } catch (error) {
    return NextResponse.json({ error: "Invalid request" }, { status: error instanceof RequestBodyError ? error.status : 400 });
  }
  const password = body && typeof body === "object" ? (body as { password?: unknown }).password : undefined;
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 || !process.env.DASHBOARD_PASSWORD) {
    return NextResponse.json({ error: "Dashboard authentication is not configured" }, { status: 503 });
  }
  try {
    const { data: allowed, error } = await getSupabaseAdmin().rpc("allow_dashboard_login");
    if (error) throw new Error("Login budget unavailable");
    if (allowed !== true) return NextResponse.json({ error: "Too many login attempts" }, { status: 429, headers: { "Retry-After": "900" } });
  } catch {
    return NextResponse.json({ error: "Authentication is temporarily unavailable" }, { status: 503 });
  }
  if (typeof password !== "string" || password.length > 512 || !verifyDashboardPassword(password)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const response = NextResponse.json({ authenticated: true });
  response.cookies.set(adminSessionCookieName(), createAdminSessionValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: adminSessionMaxAge(),
  });
  return response;
}

export async function DELETE(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const response = NextResponse.json({ authenticated: false });
  response.cookies.set(adminSessionCookieName(), "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: 0,
  });
  return response;
}
