import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CustomerAccessError } from "@/lib/security/customer-auth";
import { customerFailure } from "@/lib/security/customer-response";
import { CUSTOMER_STATE_COOKIE, CUSTOMER_STATE_PATH, hashCustomerState } from "@/lib/providers/hubspot/customer-oauth";

export const runtime = "nodejs";

/** Cancellation grants no access. Require same-origin intent and the browser's
 * HttpOnly state cookie so logout can cancel even an expired Auth session. */
export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(getServerEnv().APP_BASE_URL).origin) return customerFailure(new CustomerAccessError(403, "Origin denied"), "customer_oauth_cancel");
  let response: NextResponse;
  try {
    const state = request.cookies.get(CUSTOMER_STATE_COOKIE)?.value;
    if (state && /^[A-Za-z0-9_-]{43}$/.test(state)) {
      const result = await getSupabaseAdmin().from("customer_oauth_states").delete().eq("browser_nonce_hash", hashCustomerState(state));
      if (result.error) throw new Error("OAuth state storage unavailable");
    }
    response = NextResponse.json({ cancelled: true });
  } catch (error) { response = customerFailure(error, "customer_oauth_cancel"); }
  response.cookies.set(CUSTOMER_STATE_COOKIE, "", { path: CUSTOMER_STATE_PATH, maxAge: 0, httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
  return response;
}
