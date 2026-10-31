import "server-only";

import { getHubSpotContact } from "@/lib/providers/hubspot/client";
import { syncHubSpotContactToWix, syncWixContactToHubSpot } from "@/lib/sync/engine";
import { syncWixFormSubmissionToHubSpot } from "@/lib/sync/form-submission";
import { listEnabledMappings } from "@/lib/sync/mapping-repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  claimPendingWebhookEvent,
  finishWebhookEvent,
  getClaimedWebhookEvent,
} from "@/lib/webhooks/event-store";

export type ProcessResult = "succeeded" | "ignored";

function asId(value: unknown): string | null {
  return typeof value === "string" || typeof value === "number" ? String(value) : null;
}

function readHubSpotObjectId(payload: Record<string, unknown>): string | null {
  return asId(payload.objectId);
}

function isWixFormSubmissionEvent(eventType: string): boolean {
  const normalized = eventType.toLowerCase();
  return normalized.includes("submission") &&
    (normalized.includes("created") || normalized.includes("submitted"));
}

function isWixContactEvent(eventType: string): boolean {
  const normalized = eventType.toLowerCase();
  return normalized.includes("contact_created") ||
    normalized.includes("contact_updated") ||
    normalized === "contact.created" ||
    normalized === "contact.updated";
}

/**
 * Processes provider events from the durable queue. last_source suppresses
 * reciprocal events created by our own writes and prevents feedback loops.
 */
export async function processWebhookEvent(eventId: string): Promise<ProcessResult> {
  const claimed = await claimPendingWebhookEvent(eventId);
  if (!claimed) return "ignored";

  try {
    const event = await getClaimedWebhookEvent(eventId);
    if (!event) throw new Error("Claimed event could not be loaded");
    const db = getSupabaseAdmin();

    if (event.provider === "wix") {
      const instanceId = asId(event.payload.instanceId);
      if (!instanceId) {
        await finishWebhookEvent(eventId, "ignored", "MISSING_WIX_INSTANCE_ID");
        return "ignored";
      }

      if (isWixFormSubmissionEvent(event.eventType)) {
        const data = event.payload.data;
        if (!data || typeof data !== "object" || Array.isArray(data)) {
          await finishWebhookEvent(eventId, "ignored", "MISSING_FORM_SUBMISSION_DATA");
          return "ignored";
        }
        await syncWixFormSubmissionToHubSpot(instanceId, data as Record<string, unknown>);
        await finishWebhookEvent(eventId, "succeeded");
        return "succeeded";
      }

      if (!isWixContactEvent(event.eventType)) {
        await finishWebhookEvent(eventId, "ignored", "UNSUPPORTED_EVENT");
        return "ignored";
      }

      const wixContactId = asId(event.payload.contactId) ?? event.correlationId;
      if (!wixContactId) {
        await finishWebhookEvent(eventId, "ignored", "MISSING_WIX_CONTACT_ID");
        return "ignored";
      }

      const { data: wixConnection, error: wixError } = await db
        .from("provider_connections")
        .select("id")
        .eq("provider", "wix")
        .eq("external_account_id", instanceId)
        .is("disconnected_at", null)
        .maybeSingle();
      if (wixError) throw new Error("Unable to resolve Wix installation");
      if (!wixConnection) {
        await finishWebhookEvent(eventId, "ignored", "WIX_NOT_CONNECTED");
        return "ignored";
      }

      const { data: link, error: linkError } = await db.from("contact_links")
        .select("last_source")
        .eq("wix_connection_id", wixConnection.id)
        .eq("wix_contact_id", wixContactId)
        .maybeSingle();
      if (linkError) throw new Error("Unable to inspect Wix sync link");
      if (link?.last_source === "hubspot") {
        await finishWebhookEvent(eventId, "ignored", "SYNC_ECHO");
        return "ignored";
      }

      await syncWixContactToHubSpot(instanceId, wixContactId);
      await finishWebhookEvent(eventId, "succeeded");
      return "succeeded";
    }

    if (event.provider === "hubspot" &&
      ["contact.creation", "contact.propertyChange"].includes(event.eventType)) {
      const hubspotContactId = readHubSpotObjectId(event.payload);
      if (!hubspotContactId) {
        await finishWebhookEvent(eventId, "ignored", "MISSING_HUBSPOT_CONTACT_ID");
        return "ignored";
      }

      const { data: wixConnection, error } = await db.from("provider_connections")
        .select("id,external_account_id")
        .eq("provider", "wix")
        .is("disconnected_at", null)
        .not("external_account_id", "is", null)
        .limit(1)
        .maybeSingle();
      if (error) throw new Error("Unable to resolve Wix installation");
      if (!wixConnection?.external_account_id) {
        await finishWebhookEvent(eventId, "ignored", "WIX_NOT_CONNECTED");
        return "ignored";
      }

      const { data: link, error: linkError } = await db.from("contact_links")
        .select("last_source")
        .eq("wix_connection_id", wixConnection.id)
        .eq("hubspot_contact_id", hubspotContactId)
        .maybeSingle();
      if (linkError) throw new Error("Unable to inspect HubSpot sync link");
      if (link?.last_source === "wix") {
        await finishWebhookEvent(eventId, "ignored", "SYNC_ECHO");
        return "ignored";
      }

      const { hubspot } = await import("@/lib/sync/connection-repository").then((module) =>
        module.resolveProviderConnections(wixConnection.external_account_id as string)
      );
      const mappings = await listEnabledMappings(wixConnection.id, hubspot.id);
      const contact = await getHubSpotContact(hubspotContactId, mappings.map((mapping) => mapping.targetField));
      if (!contact.id) throw new Error("HubSpot contact response is incomplete");
      await syncHubSpotContactToWix(wixConnection.external_account_id, hubspotContactId, contact);
      await finishWebhookEvent(eventId, "succeeded");
      return "succeeded";
    }

    await finishWebhookEvent(eventId, "ignored", "UNSUPPORTED_EVENT");
    return "ignored";
  } catch {
    await finishWebhookEvent(eventId, "failed", "EVENT_PROCESSING_FAILED");
    throw new Error("Webhook event processing failed");
  }
}
