import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type SyncOrigin = "wix" | "hubspot";

/**
 * Suppresses a near-immediate echo from the provider we just wrote to.
 * Provider timestamps are required for a strong decision; missing timestamps
 * deliberately do not trigger suppression.
 */
export function isLikelySyncEcho(input: {
  incomingProvider: SyncOrigin;
  lastWrittenBy: SyncOrigin | null;
  lastSyncedAt: string | null;
  incomingUpdatedAt: string | null;
  toleranceMs?: number;
}): boolean {
  if (!input.lastWrittenBy || input.lastWrittenBy === input.incomingProvider) return false;
  if (!input.lastSyncedAt || !input.incomingUpdatedAt) return false;

  const syncedAt = Date.parse(input.lastSyncedAt);
  const updatedAt = Date.parse(input.incomingUpdatedAt);
  if (!Number.isFinite(syncedAt) || !Number.isFinite(updatedAt)) return false;

  // Only ignore an opposite-provider event whose source timestamp is no newer
  // than the sync write, within a small provider clock-skew allowance.
  const tolerance = input.toleranceMs ?? 30_000;
  return updatedAt <= syncedAt + tolerance;
}

export async function findContactLinkByWixId(wixContactId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("contact_links")
    .select("id,wix_contact_id,hubspot_contact_id,last_synced_at,last_source,wix_updated_at,hubspot_updated_at")
    .eq("wix_contact_id", wixContactId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Unable to look up contact synchronization link");
  return data;
}

export async function findContactLinkByHubSpotId(hubspotContactId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from("contact_links")
    .select("id,wix_contact_id,hubspot_contact_id,last_synced_at,last_source,wix_updated_at,hubspot_updated_at")
    .eq("hubspot_contact_id", hubspotContactId)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Unable to look up contact synchronization link");
  return data;
}
