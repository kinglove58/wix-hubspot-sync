import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type SyncOrigin = "wix" | "hubspot";

/**
 * Suppresses a near-immediate echo from the provider we last wrote to.
 * Compare the incoming event timestamp with that target provider's returned
 * update timestamp, not the local sync time (which can suppress real edits).
 */
export function isLikelySyncEcho(input: {
  incomingProvider: SyncOrigin;
  lastWrittenBy: SyncOrigin | null;
  lastWrittenTargetUpdatedAt: string | null;
  incomingUpdatedAt: string | null;
  toleranceMs?: number;
}): boolean {
  if (!input.lastWrittenBy || input.lastWrittenBy === input.incomingProvider) return false;
  if (!input.lastWrittenTargetUpdatedAt || !input.incomingUpdatedAt) return false;

  const writtenAt = Date.parse(input.lastWrittenTargetUpdatedAt);
  const incomingAt = Date.parse(input.incomingUpdatedAt);
  if (!Number.isFinite(writtenAt) || !Number.isFinite(incomingAt)) return false;

  return Math.abs(incomingAt - writtenAt) <= (input.toleranceMs ?? 30_000);
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
