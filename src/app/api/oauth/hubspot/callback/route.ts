import { NextRequest, NextResponse } from "next/server";
import { consumeOAuthState, exchangeHubSpotCode, safeCompareState } from "@/lib/providers/hubspot/oauth";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const url = new URL(request.url);
  const providerError = url.searchParams.get("error");
  if (providerError) {
    return NextResponse.redirect(new URL("/?connection=denied", request.url));
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("hubspot_oauth_state")?.value;

  if (!code || !state || !expectedState || !safeCompareState(expectedState, state)) {
    return NextResponse.json({ error: "Invalid or expired OAuth state" }, { status: 400 });
  }

  try {
    if (!await consumeOAuthState(state)) return NextResponse.json({ error: "Invalid or expired OAuth state" }, { status: 400 });
    await exchangeHubSpotCode(code);
    const response = NextResponse.redirect(new URL("/?connection=hubspot-connected", request.url));
    response.cookies.set("hubspot_oauth_state", "", { path: "/api/oauth/hubspot", maxAge: 0 });
    return response;
  } catch {
    return NextResponse.json({ error: "HubSpot connection could not be completed" }, { status: 502 });
  }
}
