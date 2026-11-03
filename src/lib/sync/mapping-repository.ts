import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { FieldMapping } from "@/lib/sync/mapping";

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
    .select("id,wix_field,hubspot_property,sync_direction,transform,enabled,allow_empty")
    .eq("wix_connection_id", wixConnectionId)
    .eq("hubspot_connection_id", hubspotConnectionId)
    .order("created_at", { ascending: true });

  if (error) throw new Error("Unable to load field mappings");
  return (data ?? []).map((row) => ({
    id: row.id as string,
    sourceField: row.wix_field as string,
    targetField: row.hubspot_property as string,
    direction: row.sync_direction === "bidirectional" ? "both" : row.sync_direction as FieldMapping["direction"],
    transform: row.transform as FieldMapping["transform"],
    enabled: Boolean(row.enabled),
    allowEmpty: row.allow_empty === true,
  }));
}
