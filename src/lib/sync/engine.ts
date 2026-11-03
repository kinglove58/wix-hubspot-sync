import "server-only";

import {
  createHubSpotContact,
  findHubSpotContactByEmail,
  updateHubSpotContact,
  getHubSpotContact,
} from "@/lib/providers/hubspot/client";
import {
  createWixContact,
  findWixContactByEmail,
  getWixContact,
  updateWixContact,
  type WixContact,
} from "@/lib/providers/wix/contacts";
import { mergeWixInfo } from "@/lib/sync/normalize";
import { resolveProviderConnections } from "@/lib/sync/connection-repository";
import { listEnabledMappings } from "@/lib/sync/mapping-repository";
import { mergedWixProperties, mergedHubSpotInfo } from "@/lib/sync/contact-mapping";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveConflict } from "@/lib/sync/conflict";
import { withIntegrationLease } from "@/lib/sync/lease";
import { prepareContactCreation, rememberContactCreation, createContactWithIntent } from "@/lib/sync/creation-intent";
import { syncAuditContext } from "@/lib/sync/audit-context";
import { logOperationFailure } from "@/lib/security/log";
import { rootFailure } from "@/lib/webhooks/retry-policy";
import { ProviderApiError } from "@/lib/providers/api-error";

async function writeAudit(wixConnectionId: string, hubspotConnectionId: string, input: {
  provider: "wix" | "hubspot";
  action: string;
  outcome: "succeeded" | "failed" | "skipped";
  wixContactId?: string;
  hubspotContactId?: string;
  details?: Record<string, unknown>;
}) {
  const { error } = await getSupabaseAdmin().from("sync_audit_logs").insert({
    provider: input.provider,
    wix_connection_id: wixConnectionId,
    hubspot_connection_id: hubspotConnectionId,
    action: input.action,
    outcome: input.outcome,
    wix_contact_id: input.wixContactId ?? null,
    hubspot_contact_id: input.hubspotContactId ?? null,
    safe_details: { ...syncAuditContext(), ...input.details },
  });
  if (error) throw new Error("Unable to write sync audit record");
}

async function auditSyncFailure<T>(pair: { wix: { id: string }; hubspot: { id: string } }, provider: "wix" | "hubspot", contactId: string, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    const cause = rootFailure(error);
    const code = cause instanceof ProviderApiError ? `${cause.provider.toUpperCase()}_HTTP_${cause.status}` : "CONTACT_SYNC_FAILED";
    try {
      await writeAudit(pair.wix.id, pair.hubspot.id, { provider, action: "contact_sync", outcome: "failed",
        ...(provider === "wix" ? { wixContactId: contactId } : { hubspotContactId: contactId }), details: { code } });
    } catch {
      // Preserve the original provider failure and retry guidance, but never hide
      // an unavailable audit store behind a successful worker response.
      logOperationFailure("SYNC_AUDIT_WRITE_FAILED", { ...syncAuditContext(), provider, operation: "audit_contact_sync", result: "failed" });
    }
    throw error;
  }
}

async function linkMatchedContact(wixConnectionId: string, hubspotConnectionId: string,
  wixContactId: string, hubspotContactId: string, wixUpdatedAt?: string, hubspotUpdatedAt?: string) {
  const { error } = await getSupabaseAdmin().from("contact_links").insert({
    wix_connection_id: wixConnectionId, hubspot_connection_id: hubspotConnectionId,
    wix_contact_id: wixContactId, hubspot_contact_id: hubspotContactId,
    wix_updated_at: wixUpdatedAt ?? null, hubspot_updated_at: hubspotUpdatedAt ?? null,
  });
  if (error) throw new Error("Unable to establish matched contact identity");
}

export async function syncWixContactToHubSpot(instanceId: string, wixContactId: string, pairId?: string) {
  return withIntegrationLease(`sync:${instanceId}`, async () => {
    const pair = await resolveProviderConnections(instanceId, pairId);
    return withIntegrationLease(`portal:${pair.hubspot.id}`, () => auditSyncFailure(pair, "wix", wixContactId, () => syncWixContact(instanceId, wixContactId, pairId)));
  });
}

async function syncWixContact(instanceId: string, wixContactId: string, pairId?: string) {
  const connections = await resolveProviderConnections(instanceId, pairId);
  const audit = (input: Parameters<typeof writeAudit>[2]) => writeAudit(connections.wix.id, connections.hubspot.id, input);
  const db = getSupabaseAdmin();
  const wix = await getWixContact(instanceId, wixContactId);
  const mappings = await listEnabledMappings(connections.wix.id, connections.hubspot.id);
  const properties = mergedWixProperties(wix, mappings, connections.useDefaultMappings);
  if (Object.keys(properties).length === 0) {
    await audit({ provider: "wix", action: "contact_sync", outcome: "skipped", wixContactId, details: { reason: "no_enabled_mapping_for_direction" } });
    return { status: "skipped" as const, reason: "no_enabled_mapping_for_direction" };
  }

  const { data: existingLink, error: linkError } = await db.from("contact_links")
    .select("hubspot_contact_id,wix_updated_at,hubspot_updated_at")
    .eq("wix_connection_id", connections.wix.id)
    .eq("hubspot_connection_id", connections.hubspot.id)
    .eq("wix_contact_id", wixContactId)
    .maybeSingle();
  if (linkError) throw new Error("Unable to read contact link");

  const liveHubSpot = existingLink?.hubspot_contact_id
    ? await getHubSpotContact(String(existingLink.hubspot_contact_id), [], connections.hubspot.id) : null;
  if (liveHubSpot) {
    const decision = resolveConflict(
      { provider: "wix", externalId: wixContactId, updatedAt: wix.updatedDate ?? null },
      { provider: "hubspot", externalId: String(existingLink?.hubspot_contact_id), updatedAt: liveHubSpot.updatedAt ?? null },
    );
    if (decision.winner !== "wix") {
      await audit({ provider: "wix", action: "contact_sync_conflict", outcome: "skipped", wixContactId, details: { reason: decision.reason } });
      return { status: "skipped" as const, reason: "hubspot_version_is_newer" };
    }
  }

  let hubspotContactId = existingLink?.hubspot_contact_id as string | undefined;
  let result;
  if (hubspotContactId) {
    result = await updateHubSpotContact(hubspotContactId, properties, connections.hubspot.id, liveHubSpot?.updatedAt);
  } else {
    const intent = await prepareContactCreation({ wixConnectionId: connections.wix.id, hubspotConnectionId: connections.hubspot.id,
      sourceProvider: "wix", sourceId: wixContactId, email: properties.email });
    const match = intent.destinationId
      ? await getHubSpotContact(intent.destinationId, [], connections.hubspot.id)
      : intent.lookupEmail ? await findHubSpotContactByEmail(intent.lookupEmail, connections.hubspot.id) : null;
    if (match?.id) {
      const identity = await db.from("contact_links").select("wix_contact_id")
        .eq("wix_connection_id", connections.wix.id)
        .eq("hubspot_connection_id", connections.hubspot.id).eq("hubspot_contact_id", match.id).maybeSingle();
      if (identity.error) throw new Error("Unable to verify matched contact identity");
      if (identity.data && identity.data.wix_contact_id !== wixContactId) {
        await audit({ provider: "wix", action: "contact_link_conflict", outcome: "skipped", wixContactId, hubspotContactId: match.id });
        return { status: "skipped" as const, reason: "hubspot_contact_already_linked" };
      }
      await rememberContactCreation(intent, match.id);
      await linkMatchedContact(connections.wix.id, connections.hubspot.id, wixContactId, match.id, wix.updatedDate, match.updatedAt);
      const decision = resolveConflict(
        { provider: "wix", externalId: wixContactId, updatedAt: wix.updatedDate ?? null },
        { provider: "hubspot", externalId: match.id, updatedAt: match.updatedAt ?? null },
      );
      if (decision.winner !== "wix") {
        await audit({ provider: "wix", action: "contact_match_conflict", outcome: "skipped", wixContactId, hubspotContactId: match.id });
        return { status: "skipped" as const, reason: "hubspot_version_is_newer" };
      }
    }
    result = match?.id
      ? await updateHubSpotContact(match.id, properties, connections.hubspot.id, match.updatedAt)
      : await createContactWithIntent(intent, () => createHubSpotContact(properties, connections.hubspot.id));
    hubspotContactId = result.id;
  }
  if (!hubspotContactId) throw new Error("HubSpot did not return a contact ID");

  const { data: conflictingLink, error: conflictLinkError } = await db.from("contact_links")
    .select("wix_contact_id")
    .eq("wix_connection_id", connections.wix.id)
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
  }, { onConflict: "wix_connection_id,hubspot_connection_id,wix_contact_id" });
  if (upsertError) throw new Error("Unable to save contact link");

  await audit({ provider: "wix", action: "contact_sync_to_hubspot", outcome: "succeeded", wixContactId, hubspotContactId });
  return { status: "succeeded" as const, wixContactId, hubspotContactId };
}

export async function syncHubSpotContactToWix(
  instanceId: string,
  hubspotContactId: string,
  contact: { id?: string; properties?: Record<string, string | null>; updatedAt?: string },
  pairId?: string,
) {
  return withIntegrationLease(`sync:${instanceId}`, async () => {
    const pair = await resolveProviderConnections(instanceId, pairId);
    return withIntegrationLease(`portal:${pair.hubspot.id}`, () => auditSyncFailure(pair, "hubspot", hubspotContactId, () => syncHubSpotContact(instanceId, hubspotContactId, contact, pairId)));
  });
}

async function syncHubSpotContact(
  instanceId: string,
  hubspotContactId: string,
  contact: { id?: string; properties?: Record<string, string | null>; updatedAt?: string },
  pairId?: string,
) {
  const connections = await resolveProviderConnections(instanceId, pairId);
  const mappings = await listEnabledMappings(connections.wix.id, connections.hubspot.id);
  // Re-read inside the write lease. The controller/worker snapshot may have
  // become stale while waiting for another synchronization to finish.
  contact = await getHubSpotContact(hubspotContactId, mappings.filter((m) => m.enabled).map((m) => m.targetField), connections.hubspot.id);
  const audit = (input: Parameters<typeof writeAudit>[2]) => writeAudit(connections.wix.id, connections.hubspot.id, input);
  const email = contact.properties?.email;
  const db = getSupabaseAdmin();
  const { data: link, error } = await db.from("contact_links")
    .select("wix_contact_id,wix_updated_at,hubspot_updated_at")
    .eq("wix_connection_id", connections.wix.id)
    .eq("hubspot_connection_id", connections.hubspot.id)
    .eq("hubspot_contact_id", hubspotContactId)
    .maybeSingle();
  if (error) throw new Error("Unable to read contact link");

  const liveWix = link?.wix_contact_id ? await getWixContact(instanceId, String(link.wix_contact_id)) : null;
  if (liveWix) {
    const decision = resolveConflict(
      { provider: "wix", externalId: String(link?.wix_contact_id), updatedAt: liveWix.updatedDate ?? null },
      { provider: "hubspot", externalId: hubspotContactId, updatedAt: contact.updatedAt ?? null },
    );
    if (decision.winner !== "hubspot") {
      await audit({ provider: "hubspot", action: "contact_sync_conflict", outcome: "skipped", hubspotContactId, details: { reason: decision.reason } });
      return { status: "skipped" as const, reason: "wix_version_is_newer" };
    }
  }

  const info = mergedHubSpotInfo(contact, mappings, connections.useDefaultMappings);
  if (Object.keys(info).length === 0) {
    await audit({ provider: "hubspot", action: "contact_sync", outcome: "skipped", hubspotContactId, details: { reason: "no_enabled_mapping_for_direction" } });
    return { status: "skipped" as const, reason: "no_enabled_mapping_for_direction" };
  }

  let wix: WixContact;
  if (link?.wix_contact_id) {
    const current = liveWix!;
    if (typeof current.revision !== "number" || !current.id) throw new Error("Wix contact revision is missing");
    wix = await updateWixContact(instanceId, current.id, current.revision, mergeWixInfo(current.info ?? {}, info));
  } else {
    const intent = await prepareContactCreation({ wixConnectionId: connections.wix.id, hubspotConnectionId: connections.hubspot.id,
      sourceProvider: "hubspot", sourceId: hubspotContactId, email });
    const existingWix = intent.destinationId ? await getWixContact(instanceId, intent.destinationId)
      : intent.lookupEmail ? await findWixContactByEmail(instanceId, intent.lookupEmail) : undefined;
    if (existingWix?.id) {
      const identity = await db.from("contact_links").select("hubspot_contact_id")
        .eq("hubspot_connection_id", connections.hubspot.id)
        .eq("wix_connection_id", connections.wix.id).eq("wix_contact_id", existingWix.id).maybeSingle();
      if (identity.error) throw new Error("Unable to verify matched contact identity");
      if (identity.data && identity.data.hubspot_contact_id !== hubspotContactId) {
        await audit({ provider: "hubspot", action: "contact_link_conflict", outcome: "skipped", hubspotContactId, wixContactId: existingWix.id });
        return { status: "skipped" as const, reason: "wix_contact_already_linked" };
      }
      await rememberContactCreation(intent, existingWix.id);
      await linkMatchedContact(connections.wix.id, connections.hubspot.id, existingWix.id, hubspotContactId, existingWix.updatedDate, contact.updatedAt);
      const decision = resolveConflict(
        { provider: "wix", externalId: existingWix.id, updatedAt: existingWix.updatedDate ?? null },
        { provider: "hubspot", externalId: hubspotContactId, updatedAt: contact.updatedAt ?? null },
      );
      if (decision.winner !== "hubspot") {
        await audit({ provider: "hubspot", action: "contact_match_conflict", outcome: "skipped", hubspotContactId, wixContactId: existingWix.id });
        return { status: "skipped" as const, reason: "wix_version_is_newer" };
      }
      if (typeof existingWix.revision !== "number") throw new Error("Matched Wix contact revision is missing");
      wix = await updateWixContact(instanceId, existingWix.id, existingWix.revision, mergeWixInfo(existingWix.info ?? {}, info));
    } else {
      wix = await createContactWithIntent(intent, () => createWixContact(instanceId, info));
    }
  }
  if (!wix.id) throw new Error("Wix did not return a contact ID");

  const { data: conflictingLink, error: conflictLinkError } = await db.from("contact_links")
    .select("hubspot_contact_id")
    .eq("hubspot_connection_id", connections.hubspot.id)
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
  }, { onConflict: "wix_connection_id,hubspot_connection_id,wix_contact_id" });
  if (upsertError) throw new Error("Unable to save contact link");

  await audit({ provider: "hubspot", action: "contact_sync_to_wix", outcome: "succeeded", wixContactId: wix.id, hubspotContactId });
  return { status: "succeeded" as const, wixContactId: wix.id, hubspotContactId };
}
