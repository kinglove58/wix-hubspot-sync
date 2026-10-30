import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function resolveProviderConnections(instanceId: string) {
  if (!instanceId.trim()) throw new Error("Wix instance ID is required");
  const db = getSupabaseAdmin();
  const wix = await db.from("provider_connections").select("id,external_account_id").eq("provider", "wix").eq("external_account_id", instanceId).is("disconnected_at", null).maybeSingle();
  if (wix.error || !wix.data) throw new Error("Wix installation is not connected");
  const hubspot = await db.from("provider_connections").select("id,external_account_id").eq("provider", "hubspot").is("disconnected_at", null).order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (hubspot.error || !hubspot.data) throw new Error("HubSpot is not connected");
  return { wix: wix.data, hubspot: hubspot.data };
}
