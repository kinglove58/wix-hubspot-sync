import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/security/customer-auth";
import { customerFailure } from "@/lib/security/customer-response";
import { buildHubSpotAuthorizationUrl, createOAuthState } from "@/lib/providers/hubspot/oauth";
import { CUSTOMER_STATE_COOKIE, CUSTOMER_STATE_PATH, customerRedirectUri, storeCustomerState } from "@/lib/providers/hubspot/customer-oauth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await requireTenantContext(request, true);
    const state = createOAuthState();
    const browserNonce = createOAuthState();
    const authorizationUrl = buildHubSpotAuthorizationUrl(state, customerRedirectUri());
    await storeCustomerState(state, browserNonce, context, request.headers.get("authorization")!.slice(7));
    const response = NextResponse.json({ authorizationUrl });
    response.cookies.set(CUSTOMER_STATE_COOKIE, browserNonce, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: CUSTOMER_STATE_PATH, maxAge: 600 });
    return response;
  } catch (error) { return customerFailure(error, "customer_hubspot_start"); }
}
