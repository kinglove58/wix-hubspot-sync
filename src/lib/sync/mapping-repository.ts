import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { validateMappings, type FieldMapping } from "@/lib/sync/mapping";

export interface StoredFieldMapping extends FieldMapping {
  id: string;
  enabled: boolean;
}

export async function listEnabledMappings(
  wixConnectionId: string,
  hubspotConnectionId: string,
): Promise<StoredFieldMapping[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("field_mappings")
    .select("id,wix_field,hubspot_property,sync_direction,transform,enabled")
    .eq("wix_connection_id", wixConnectionId)
    .eq("hubspot_connection_id", hubspotConnectionId)
    .eq("enabled", true)
    .order("created_at", { ascending: true });

  if (error) throw new Error("Unable to load field mappings");
  return (data ?? []).map((row) => ({
    id: row.id as string,
    sourceField: row.wix_field as string,
    targetField: row.hubspot_property as string,
    direction: row.sync_direction === "bidirectional" ? "both" : row.sync_direction as FieldMapping["direction"],
    transform: row.transform as FieldMapping["transform"],
    enabled: Boolean(row.enabled),
  }));
}

export async function saveFieldMapping(input: {
  wixConnectionId: string;
  hubspotConnectionId: string;
  wixField: string;
  hubspotProperty: string;
  direction: "wix_to_hubspot" | "hubspot_to_wix" | "bidirectional";
  transform?: "none" | "trim" | "lowercase" | "uppercase";
}): Promise<void> {
  const candidate: FieldMapping = {
    sourceField: input.wixField,
    targetField: input.hubspotProperty,
    direction: input.direction === "bidirectional" ? "both" : input.direction,
    transform: input.transform ?? "none",
  };
  const errors = validateMappings([candidate]);
  if (errors.length) throw new Error(errors.join("; "));

  const { data: wixConnection, error: wixError } = await getSupabaseAdmin()
    .from("provider_connections")
    .select("id")
    .eq("id", input.wixConnectionId)
    .eq("provider", "wix")
    .is("disconnected_at", null)
    .maybeSingle();
  const { data: hubspotConnection, error: hubspotError } = await getSupabaseAdmin()
    .from("provider_connections")
    .select("id")
    .eq("id", input.hubspotConnectionId)
    .eq("provider", "hubspot")
    .is("disconnected_at", null)
    .maybeSingle();

  if (wixError || hubspotError || !wixConnection || !hubspotConnection) {
    throw new Error("Active Wix and HubSpot connections are required");
  }

  const { error } = await getSupabaseAdmin().from("field_mappings").upsert({
    wix_connection_id: input.wixConnectionId,
    hubspot_connection_id: input.hubspotConnectionId,
    wix_field: input.wixField.trim(),
    hubspot_property: input.hubspotProperty.trim(),
    sync_direction: input.direction,
    transform: input.transform ?? "none",
    enabled: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: "wix_connection_id,hubspot_connection_id,wix_field,hubspot_property" });
  if (error) throw new Error("Unable to save field mapping");
}
