import "server-only";

import {
  createHubSpotContact,
  findHubSpotContactByEmail,
  updateHubSpotContact,
} from "@/lib/providers/hubspot/client";
import {
  createWixContact,
  getWixContact,
  updateWixContact,
  type WixContact,
} from "@/lib/providers/wix/contacts";
import { hubSpotContactToWixInfo, wixContactToHubSpotProperties } from "@/lib/sync/normalize";
import { resolveProviderConnections } from "@/lib/sync/connection-repository";
import { listEnabledMappings } from "@/lib/sync/mapping-repository";
import { mapHubSpotPayloadToWix, mapWixPayloadToHubSpot } from "@/lib/sync/provider-mapping";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

function toHubSpotProperties(input: Record<string, unknown>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined || typeof value === "object") continue;
    output[key] = String(value);
  }
  return output;
}

async function audit(input: {
  provider: "wix" | "hubspot";
  action: string;
  outcome: "succeeded" | "failed" | "skipped";
  wixContactId?: string;
  hubspotContactId?: string;
  details?: Record<string, unknown>;
}) {
  const { error } = await getSupabaseAdmin().from("sync_audit_logs").insert({
    provider: input.provider,
    action: input.action,
    outcome: input.outcome,
    wix_contact_id: input.wixContactId ?? null,
    hubspot_contact_id: input.hubspotContactId ?? null,
    safe_details: input.details ?? {},
  });
  if (error) throw new Error("Unable to write sync audit record");
}

export async function syncWixContactToHubSpot(instanceId: string, wixContactId: string) {
  const connections = await resolveProviderConnections(instanceId);
  const db = getSupabaseAdmin();
  const wix = await getWixContact(instanceId, wixContactId);
  const mappings = await listEnabledMappings(connections.wix.id, connections.hubspot.id);
  const mapped = mappings.length
    ? mapWixPayloadToHubSpot(wix as unknown as Record<string, unknown>, mappings)
    : {};
  const properties = {
    ...wixContactToHubSpotProperties(wix),
    ...toHubSpotProperties(mapped),
  };
  if (!properties.email) {
    await audit({ provider: "wix", action: "contact_sync", outcome: "skipped", wixContactId, details: { reason: "email_required_for_matching" } });
    return { status: "skipped" as const, reason: "email_required_for_matching" };
  }

  const { data: existingLink, error: linkError } = await db.from("contact_links")
    .select("hubspot_contact_id")
    .eq("wix_connection_id", connections.wix.id)
    .eq("hubspot_connection_id", connections.hubspot.id)
    .eq("wix_contact_id", wixContactId)
    .maybeSingle();
  if (linkError) throw new Error("Unable to read contact link");

  let hubspotContactId = existingLink?.hubspot_contact_id as string | undefined;
  let result;
  if (hubspotContactId) {
    result = await updateHubSpotContact(hubspotContactId, properties);
  } else {
    const match = await findHubSpotContactByEmail(properties.email);
    result = match?.id
      ? await updateHubSpotContact(match.id, properties)
      : await createHubSpotContact(properties);
    hubspotContactId = result.id;
  }
  if (!hubspotContactId) throw new Error("HubSpot did not return a contact ID");

  const { error: upsertError } = await db.from("contact_links").upsert({
    wix_connection_id: connections.wix.id,
    hubspot_connection_id: connections.hubspot.id,
    wix_contact_id: wixContactId,
    hubspot_contact_id: hubspotContactId,
    last_synced_at: new Date().toISOString(),
    last_source: "wix",
    wix_updated_at: wix.updatedDate ?? null,
  }, { onConflict: "wix_connection_id,wix_contact_id" });
  if (upsertError) throw new Error("Unable to save contact link");

  await audit({ provider: "wix", action: "contact_sync_to_hubspot", outcome: "succeeded", wixContactId, hubspotContactId });
  return { status: "succeeded" as const, wixContactId, hubspotContactId };
}

export async function syncHubSpotContactToWix(
  instanceId: string,
  hubspotContactId: string,
  contact: { id?: string; properties?: Record<string, string | null>; updatedAt?: string },
) {
  const connections = await resolveProviderConnections(instanceId);
  const email = contact.properties?.email;
  if (!email) {
    await audit({ provider: "hubspot", action: "contact_sync", outcome: "skipped", hubspotContactId, details: { reason: "email_required_for_matching" } });
    return { status: "skipped" as const, reason: "email_required_for_matching" };
  }

  const db = getSupabaseAdmin();
  const { data: link, error } = await db.from("contact_links")
    .select("wix_contact_id")
    .eq("wix_connection_id", connections.wix.id)
    .eq("hubspot_connection_id", connections.hubspot.id)
    .eq("hubspot_contact_id", hubspotContactId)
    .maybeSingle();
  if (error) throw new Error("Unable to read contact link");

  const mappings = await listEnabledMappings(connections.wix.id, connections.hubspot.id);
  const mapped = mappings.length
    ? mapHubSpotPayloadToWix((contact.properties ?? {}) as Record<string, unknown>, mappings)
    : {};
  const info = (mappings.length
    ? mapped
    : hubSpotContactToWixInfo(contact)) as NonNullable<WixContact["info"]>;

  let wix: WixContact;
  if (link?.wix_contact_id) {
    const current = await getWixContact(instanceId, link.wix_contact_id as string);
    if (typeof current.revision !== "number" || !current.id) throw new Error("Wix contact revision is missing");
    wix = await updateWixContact(instanceId, current.id, current.revision, info);
  } else {
    wix = await createWixContact(instanceId, info);
  }
  if (!wix.id) throw new Error("Wix did not return a contact ID");

  const { error: upsertError } = await db.from("contact_links").upsert({
    wix_connection_id: connections.wix.id,
    hubspot_connection_id: connections.hubspot.id,
    wix_contact_id: wix.id,
    hubspot_contact_id: hubspotContactId,
    last_synced_at: new Date().toISOString(),
    last_source: "hubspot",
    hubspot_updated_at: contact.updatedAt ?? null,
  }, { onConflict: "wix_connection_id,wix_contact_id" });
  if (upsertError) throw new Error("Unable to save contact link");

  await audit({ provider: "hubspot", action: "contact_sync_to_wix", outcome: "succeeded", wixContactId: wix.id, hubspotContactId });
  return { status: "succeeded" as const, wixContactId: wix.id, hubspotContactId };
}
