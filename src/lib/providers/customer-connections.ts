import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { encryptToken } from "@/lib/security/token-crypto";
import type { TenantContext } from "@/lib/security/customer-auth";
import { CustomerAccessError } from "@/lib/security/customer-auth";

export async function saveCustomerConnection(context: Pick<TenantContext, "userId" | "tenantId">, input: {
  provider: "wix" | "hubspot"; accountId: string; label: string; accessToken: string;
  refreshToken?: string; expiresIn: number; scopes?: string[];
}) {
  const result = await getSupabaseAdmin().rpc("save_customer_connection", {
    p_tenant_id: context.tenantId, p_user_id: context.userId, p_provider: input.provider,
    p_account_id: input.accountId, p_label: input.label, p_access_token: encryptToken(input.accessToken),
    p_refresh_token: input.refreshToken ? encryptToken(input.refreshToken) : null,
    p_expires_at: new Date(Date.now() + input.expiresIn * 1000).toISOString(), p_scopes: input.scopes ?? [],
  });
  if (result.error || typeof result.data !== "string") throw new CustomerAccessError(409, "Unable to connect this account; verify ownership and tenant membership");
  return { id: result.data, provider: input.provider, external_account_id: input.accountId };
}
