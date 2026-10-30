import { NextRequest, NextResponse } from "next/server";
import { exchangeHubSpotCode, safeCompareState } from "@/lib/providers/hubspot/oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
    await exchangeHubSpotCode(code);
    const response = NextResponse.redirect(new URL("/?connection=hubspot-connected", request.url));
    response.cookies.delete("hubspot_oauth_state");
    return response;
  } catch {
    return NextResponse.json({ error: "HubSpot connection could not be completed" }, { status: 502 });
  }
}
