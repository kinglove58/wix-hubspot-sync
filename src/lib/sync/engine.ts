import "server-only";

import {
  createHubSpotContact,
  findHubSpotContactByEmail,
  updateHubSpotContact,
} from "@/lib/providers/hubspot/client";
import {
  createWixContact,
  findWixContactByEmail,
  getWixContact,
  updateWixContact,
  type WixContact,
} from "@/lib/providers/wix/contacts";
import { hubSpotContactToWixInfo, wixContactToHubSpotProperties } from "@/lib/sync/normalize";
import { resolveProviderConnections } from "@/lib/sync/connection-repository";
import { listEnabledMappings } from "@/lib/sync/mapping-repository";
import { mapHubSpotPayloadToWix, mapWixPayloadToHubSpot } from "@/lib/sync/provider-mapping";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveConflict } from "@/lib/sync/conflict";

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
  if (mappings.length && Object.keys(mapped).length === 0) {
    await audit({ provider: "wix", action: "contact_sync", outcome: "skipped", wixContactId, details: { reason: "no_enabled_mapping_for_direction" } });
    return { status: "skipped" as const, reason: "no_enabled_mapping_for_direction" };
  }
  const properties = mappings.length
    ? toHubSpotProperties(mapped)
    : wixContactToHubSpotProperties(wix);

  const { data: existingLink, error: linkError } = await db.from("contact_links")
    .select("hubspot_contact_id,wix_updated_at,hubspot_updated_at")
    .eq("wix_connection_id", connections.wix.id)
    .eq("hubspot_connection_id", connections.hubspot.id)
    .eq("wix_contact_id", wixContactId)
    .maybeSingle();
  if (linkError) throw new Error("Unable to read contact link");
  if (!properties.email && !existingLink?.hubspot_contact_id) {
    await audit({ provider: "wix", action: "contact_sync", outcome: "skipped", wixContactId, details: { reason: "email_required_for_new_contact_match" } });
    return { status: "skipped" as const, reason: "email_required_for_new_contact_match" };
  }

  if (existingLink?.hubspot_updated_at && wix.updatedDate) {
    const decision = resolveConflict(
      { provider: "wix", externalId: wixContactId, updatedAt: wix.updatedDate },
      { provider: "hubspot", externalId: String(existingLink.hubspot_contact_id), updatedAt: existingLink.hubspot_updated_at as string },
    );
    if (decision.winner !== "wix") {
      await audit({ provider: "wix", action: "contact_sync_conflict", outcome: "skipped", wixContactId, details: { reason: decision.reason } });
      return { status: "skipped" as const, reason: "hubspot_version_is_newer" };
    }
  }

  let hubspotContactId = existingLink?.hubspot_contact_id as string | undefined;
  let result;
  if (hubspotContactId) {
    result = await updateHubSpotContact(hubspotContactId, properties);
  } else {
    const match = await findHubSpotContactByEmail(properties.email!);
    result = match?.id
      ? await updateHubSpotContact(match.id, properties)
      : await createHubSpotContact(properties);
    hubspotContactId = result.id;
  }
  if (!hubspotContactId) throw new Error("HubSpot did not return a contact ID");

  const { data: conflictingLink, error: conflictLinkError } = await db.from("contact_links")
    .select("wix_contact_id")
    .eq("hubspot_connection_id", connections.hubspot.id)
    .eq("hubspot_contact_id", hubspotContactId)
    .maybeSingle();
  if (conflictLinkError) throw new Error("Unable to verify contact identity link");
  if (conflictingLink && conflictingLink.wix_contact_id !== wixContactId) {
    await audit({ provider: "wix", action: "contact_link_conflict", outcome: "skipped", wixContactId, hubspotContactId, details: { reason: "hubspot_contact_already_linked" } });
    return { status: "skipped" as const, reason: "hubspot_contact_already_linked" };
  }

  const { error: upsertError } = await db.from("contact_links").upsert({
    wix_connection_id: connections.wix.id,
    hubspot_connection_id: connections.hubspot.id,
    wix_contact_id: wixContactId,
    hubspot_contact_id: hubspotContactId,
    last_synced_at: new Date().toISOString(),
    last_source: "wix",
    wix_updated_at: wix.updatedDate ?? null,
    hubspot_updated_at: result.updatedAt ?? null,
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
  const db = getSupabaseAdmin();
  const { data: link, error } = await db.from("contact_links")
    .select("wix_contact_id,wix_updated_at,hubspot_updated_at")
    .eq("wix_connection_id", connections.wix.id)
    .eq("hubspot_connection_id", connections.hubspot.id)
    .eq("hubspot_contact_id", hubspotContactId)
    .maybeSingle();
  if (error) throw new Error("Unable to read contact link");
  if (!email && !link?.wix_contact_id) {
    await audit({ provider: "hubspot", action: "contact_sync", outcome: "skipped", hubspotContactId, details: { reason: "email_required_for_new_contact_match" } });
    return { status: "skipped" as const, reason: "email_required_for_new_contact_match" };
  }

  if (link?.wix_updated_at && contact.updatedAt) {
    const decision = resolveConflict(
      { provider: "wix", externalId: String(link.wix_contact_id), updatedAt: link.wix_updated_at as string },
      { provider: "hubspot", externalId: hubspotContactId, updatedAt: contact.updatedAt },
    );
    if (decision.winner !== "hubspot") {
      await audit({ provider: "hubspot", action: "contact_sync_conflict", outcome: "skipped", hubspotContactId, details: { reason: decision.reason } });
      return { status: "skipped" as const, reason: "wix_version_is_newer" };
    }
  }

  const mappings = await listEnabledMappings(connections.wix.id, connections.hubspot.id);
  const mapped = mappings.length
    ? mapHubSpotPayloadToWix((contact.properties ?? {}) as Record<string, unknown>, mappings)
    : {};
  if (mappings.length && Object.keys(mapped).length === 0) {
    await audit({ provider: "hubspot", action: "contact_sync", outcome: "skipped", hubspotContactId, details: { reason: "no_enabled_mapping_for_direction" } });
    return { status: "skipped" as const, reason: "no_enabled_mapping_for_direction" };
  }
  const info = (mappings.length
    ? mapped
    : hubSpotContactToWixInfo(contact)) as NonNullable<WixContact["info"]>;

  let wix: WixContact;
  if (link?.wix_contact_id) {
    const current = await getWixContact(instanceId, link.wix_contact_id as string);
    if (typeof current.revision !== "number" || !current.id) throw new Error("Wix contact revision is missing");
    wix = await updateWixContact(instanceId, current.id, current.revision, info);
  } else {
    const existingWix = email ? await findWixContactByEmail(instanceId, email) : undefined;
    if (existingWix?.id) {
      if (typeof existingWix.revision !== "number") throw new Error("Matched Wix contact revision is missing");
      wix = await updateWixContact(instanceId, existingWix.id, existingWix.revision, info);
    } else {
      wix = await createWixContact(instanceId, info);
    }
  }
  if (!wix.id) throw new Error("Wix did not return a contact ID");

  const { data: conflictingLink, error: conflictLinkError } = await db.from("contact_links")
    .select("hubspot_contact_id")
    .eq("wix_connection_id", connections.wix.id)
    .eq("wix_contact_id", wix.id)
    .maybeSingle();
  if (conflictLinkError) throw new Error("Unable to verify contact identity link");
  if (conflictingLink && conflictingLink.hubspot_contact_id !== hubspotContactId) {
    await audit({ provider: "hubspot", action: "contact_link_conflict", outcome: "skipped", wixContactId: wix.id, hubspotContactId, details: { reason: "wix_contact_already_linked" } });
    return { status: "skipped" as const, reason: "wix_contact_already_linked" };
  }

  const { error: upsertError } = await db.from("contact_links").upsert({
    wix_connection_id: connections.wix.id,
    hubspot_connection_id: connections.hubspot.id,
    wix_contact_id: wix.id,
    hubspot_contact_id: hubspotContactId,
    last_synced_at: new Date().toISOString(),
    last_source: "hubspot",
    hubspot_updated_at: contact.updatedAt ?? null,
    wix_updated_at: wix.updatedDate ?? null,
  }, { onConflict: "wix_connection_id,wix_contact_id" });
  if (upsertError) throw new Error("Unable to save contact link");

  await audit({ provider: "hubspot", action: "contact_sync_to_wix", outcome: "succeeded", wixContactId: wix.id, hubspotContactId });
  return { status: "succeeded" as const, wixContactId: wix.id, hubspotContactId };
}
