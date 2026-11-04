import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { CustomerAccessError, tenantContextForVerifiedUser } from "@/lib/security/customer-auth";
import { customerFailure } from "@/lib/security/customer-response";
import { requestHubSpotAuthorizationToken } from "@/lib/providers/hubspot/oauth";
import { CUSTOMER_STATE_COOKIE, CUSTOMER_STATE_PATH, consumeCustomerState, customerRedirectUri } from "@/lib/providers/hubspot/customer-oauth";
import { saveCustomerConnection } from "@/lib/providers/customer-connections";

export const runtime = "nodejs";
const clearState = (response: NextResponse) => {
  response.cookies.set(CUSTOMER_STATE_COOKIE, "", { path: CUSTOMER_STATE_PATH, maxAge: 0, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
  return response;
};

export async function GET(request: NextRequest) {
  let consumed = false;
  try {
    if (process.env.CUSTOMER_ACCESS_ENABLED !== "true") throw new CustomerAccessError(503, "Customer access is not enabled");
    const state = request.nextUrl.searchParams.get("state"), browserNonce = request.cookies.get(CUSTOMER_STATE_COOKIE)?.value;
    if (!state || !browserNonce || !/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{43}$/.test(browserNonce)) throw new CustomerAccessError(400, "Invalid or expired OAuth state");
    const providerError = request.nextUrl.searchParams.get("error");
    const code = request.nextUrl.searchParams.get("code");
    if (!providerError && (!code || code.length > 4096)) throw new CustomerAccessError(400, "A valid authorization code is required");
    const context = await consumeCustomerState(state, browserNonce);
    consumed = true;
    if (providerError) return clearState(NextResponse.redirect(new URL("/customer?connection=denied", getServerEnv().APP_BASE_URL)));
    const user = await getSupabaseAdmin().auth.getUser(context.accessToken);
    if (user.error || user.data.user?.id !== context.userId || !user.data.user.email_confirmed_at || user.data.user.is_anonymous) throw new CustomerAccessError(403, "Customer access denied");
    await tenantContextForVerifiedUser(context.userId, context.tenantId, true);
    const token = await requestHubSpotAuthorizationToken(code!, customerRedirectUri());
    await saveCustomerConnection(context, { provider: "hubspot", accountId: String(token.hub_id), label: `HubSpot portal ${token.hub_id}`, accessToken: token.access_token, refreshToken: token.refresh_token, expiresIn: token.expires_in, scopes: token.scopes });
    return clearState(NextResponse.redirect(new URL(`/customer?connection=hubspot-connected&tenant=${context.tenantId}`, getServerEnv().APP_BASE_URL)));
  } catch (error) {
    const response = customerFailure(error, "customer_hubspot_callback");
    return consumed ? clearState(response) : response;
  }
}
