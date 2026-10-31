import { NextRequest, NextResponse } from "next/server";
import { buildHubSpotAuthorizationUrl, createOAuthState } from "@/lib/providers/hubspot/oauth";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) {
    return NextResponse.json({ error: "Sign in to the dashboard before connecting HubSpot" }, { status: 401 });
  }
  try {
    const state = createOAuthState();
    const response = NextResponse.redirect(buildHubSpotAuthorizationUrl(state));
    response.cookies.set("hubspot_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/oauth/hubspot",
      maxAge: 10 * 60,
    });
    return response;
  } catch {
    return NextResponse.json({ error: "HubSpot OAuth is not configured" }, { status: 503 });
  }
}
