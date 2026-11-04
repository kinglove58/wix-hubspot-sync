import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getServerEnv } from "@/lib/env";
import { CustomerAccessError, type TenantContext } from "@/lib/security/customer-auth";
import { encryptToken, decryptToken } from "@/lib/security/token-crypto";

export const CUSTOMER_STATE_COOKIE = "wixhub_customer_oauth_browser";
export const CUSTOMER_STATE_PATH = "/api/customer/oauth/hubspot";
export const hashCustomerState = (state: string) => createHash("sha256").update(state).digest("hex");

export function customerRedirectUri(): string {
  const env = getServerEnv();
  const base = new URL(env.APP_BASE_URL);
  const redirect = new URL(env.HUBSPOT_CUSTOMER_REDIRECT_URI || "/api/customer/oauth/hubspot/callback", base);
  if (redirect.origin !== base.origin || redirect.pathname !== "/api/customer/oauth/hubspot/callback" || redirect.search || redirect.hash || process.env.NODE_ENV === "production" && redirect.protocol !== "https:") {
    throw new CustomerAccessError(503, "Customer OAuth redirect is not configured correctly");
  }
  return redirect.toString();
}

export async function storeCustomerState(state: string, browserNonce: string, context: Pick<TenantContext, "tenantId" | "userId">, accessToken: string) {
  const expired = await getSupabaseAdmin().from("customer_oauth_states").delete().lt("expires_at", new Date().toISOString());
  if (expired.error) throw new Error("OAuth state storage unavailable");
  const result = await getSupabaseAdmin().from("customer_oauth_states").insert({
    state_hash: hashCustomerState(state), tenant_id: context.tenantId, user_id: context.userId,
    browser_nonce_hash: hashCustomerState(browserNonce),
    encrypted_user_token: encryptToken(accessToken),
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  if (result.error) throw new Error("OAuth state storage unavailable");
}

export async function consumeCustomerState(state: string, browserNonce: string): Promise<{ tenantId: string; userId: string; accessToken: string }> {
  const result = await getSupabaseAdmin().from("customer_oauth_states").delete()
    .eq("state_hash", hashCustomerState(state)).eq("browser_nonce_hash", hashCustomerState(browserNonce))
    .gt("expires_at", new Date().toISOString()).select("tenant_id,user_id,encrypted_user_token").maybeSingle();
  if (result.error) throw new Error("OAuth state storage unavailable");
  const parsed = z.object({ tenant_id: z.uuid(), user_id: z.uuid(), encrypted_user_token: z.string() }).safeParse(result.data);
  if (!parsed.success) throw new CustomerAccessError(400, "Invalid or expired OAuth state");
  return { tenantId: parsed.data.tenant_id, userId: parsed.data.user_id, accessToken: decryptToken(parsed.data.encrypted_user_token) };
}
