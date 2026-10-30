import { NextResponse } from "next/server";
import { buildHubSpotAuthorizationUrl, createOAuthState } from "@/lib/providers/hubspot/oauth";

export const runtime = "nodejs";

export function GET() {
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
