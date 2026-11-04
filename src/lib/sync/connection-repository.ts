import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

async function assertPairOwnership(wix: { tenant_id?: string | null }, hubspot: { tenant_id?: string | null }) {
  const tenantId = wix.tenant_id ?? null;
  if (tenantId !== (hubspot.tenant_id ?? null)) throw new Error("Integration pair ownership is unresolved");
  if (tenantId) {
    const tenant = await getSupabaseAdmin().from("tenants").select("id").eq("id", tenantId).is("disabled_at", null).maybeSingle();
    if (tenant.error || !tenant.data) throw new Error("Integration tenant is unavailable");
  }
}

export async function resolveProviderConnections(instanceId: string, pairId?: string) {
  if (!instanceId.trim()) throw new Error("Wix instance ID is required");
  const db = getSupabaseAdmin();
  const wix = await db.from("provider_connections").select("id,external_account_id,tenant_id").eq("provider", "wix").eq("external_account_id", instanceId).is("disconnected_at", null).maybeSingle();
  if (wix.error || !wix.data) throw new Error("Wix installation is not connected");
  const removal = await db.rpc("wix_removal_is_pending", { p_instance_id: instanceId });
  if (removal.error || removal.data !== false) throw new Error("Wix installation lifecycle is unresolved");
  let query = db.from("integration_pairs").select("id,hubspot_connection_id,use_default_mappings").eq("wix_connection_id", wix.data.id);
  if (pairId) query = query.eq("id", pairId);
  const pair = await query.maybeSingle();
  if (pair.error || !pair.data) throw new Error("Wix installation has no explicit HubSpot pairing");
  const hubspot = await db.from("provider_connections").select("id,external_account_id,tenant_id").eq("provider", "hubspot").eq("id", pair.data.hubspot_connection_id).is("disconnected_at", null).maybeSingle();
  if (hubspot.error || !hubspot.data) throw new Error("HubSpot is not connected");
  await assertPairOwnership(wix.data, hubspot.data);
  return { wix: wix.data, hubspot: hubspot.data, pairId: pair.data.id as string, useDefaultMappings: pair.data.use_default_mappings !== false };
}

export async function listSyncTargets(provider: "wix" | "hubspot", accountId: string): Promise<Array<{ pairId: string; instanceId: string }>> {
  const db = getSupabaseAdmin();
  const source = await db.from("provider_connections").select("id").eq("provider", provider)
    .eq("external_account_id", accountId).is("disconnected_at", null).maybeSingle();
  if (source.error || !source.data) throw new Error("Source account is not connected");
  const pairs = await db.from("integration_pairs").select("id,wix_connection_id,hubspot_connection_id")
    .eq(provider === "wix" ? "wix_connection_id" : "hubspot_connection_id", source.data.id);
  if (pairs.error || !pairs.data?.length) throw new Error("Source account has no explicit integration pairs");
  const ids = [...new Set(pairs.data.flatMap((p) => [p.wix_connection_id as string, p.hubspot_connection_id as string]))];
  const active = await db.from("provider_connections").select("id,provider,external_account_id,tenant_id").in("id", ids).is("disconnected_at", null);
  if (active.error) throw new Error("Unable to resolve paired accounts");
  return pairs.data.flatMap((p) => {
    const wix = active.data?.find((c) => c.id === p.wix_connection_id && c.provider === "wix");
    const hubspot = active.data?.find((c) => c.id === p.hubspot_connection_id && c.provider === "hubspot");
    if (wix && hubspot && (wix.tenant_id ?? null) !== (hubspot.tenant_id ?? null)) throw new Error("Integration pair ownership is unresolved");
    return wix?.external_account_id && hubspot ? [{ pairId: p.id as string, instanceId: wix.external_account_id as string }] : [];
  });
}

export async function resolveWixInstanceForPortal(portalId: string): Promise<string> {
  const db = getSupabaseAdmin();
  const hubspot = await db.from("provider_connections").select("id").eq("provider", "hubspot")
    .eq("external_account_id", portalId).is("disconnected_at", null).maybeSingle();
  if (hubspot.error || !hubspot.data) throw new Error("HubSpot portal is not connected");
  const pair = await db.from("integration_pairs").select("wix_connection_id")
    .eq("hubspot_connection_id", hubspot.data.id).maybeSingle();
  if (pair.error || !pair.data) throw new Error("HubSpot portal has no explicit Wix pairing");
  const wix = await db.from("provider_connections").select("external_account_id").eq("provider", "wix")
    .eq("id", pair.data.wix_connection_id).is("disconnected_at", null).maybeSingle();
  if (wix.error || !wix.data?.external_account_id) throw new Error("Wix installation is not connected");
  return wix.data.external_account_id as string;
}
