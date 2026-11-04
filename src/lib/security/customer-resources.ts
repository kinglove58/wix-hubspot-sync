import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { CustomerAccessError, requireOwnedConnection, type TenantContext } from "@/lib/security/customer-auth";

/** Resolve account identifiers only inside the already-authorized tenant. */
export async function requireOwnedAccount(context: TenantContext, provider: "wix" | "hubspot", accountId: string) {
  if (!accountId.trim() || accountId.length > 512) throw new CustomerAccessError(400, "A valid provider account is required");
  const result = await getSupabaseAdmin().from("provider_connections").select("id,external_account_id,disconnected_at")
    .eq("provider", provider).eq("external_account_id", accountId).eq("tenant_id", context.tenantId).maybeSingle();
  if (result.error) throw new CustomerAccessError(503, "Unable to verify connection access");
  if (!result.data) throw new CustomerAccessError(403, "Connection access denied");
  return result.data as { id: string; external_account_id: string; disconnected_at: string | null };
}

export async function requireOwnedPair(context: TenantContext, wixConnectionId: string, pairId?: string) {
  await requireOwnedConnection(context, wixConnectionId, "wix");
  let query = getSupabaseAdmin().from("integration_pairs").select("id,wix_connection_id,hubspot_connection_id").eq("wix_connection_id", wixConnectionId);
  if (pairId) query = query.eq("id", pairId);
  const result = await query.limit(2);
  if (result.error) throw new CustomerAccessError(503, "Unable to verify pair access");
  if (result.data?.length !== 1) throw new CustomerAccessError(pairId ? 403 : 409, pairId ? "Pair access denied" : "Select an explicit integration pair");
  const pair = result.data[0];
  await requireOwnedConnection(context, pair.hubspot_connection_id, "hubspot");
  return pair as { id: string; wix_connection_id: string; hubspot_connection_id: string };
}
