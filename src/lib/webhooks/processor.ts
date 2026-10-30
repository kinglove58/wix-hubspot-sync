import "server-only";

import { getHubSpotContact } from "@/lib/providers/hubspot/client";
import { syncHubSpotContactToWix, syncWixContactToHubSpot } from "@/lib/sync/engine";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  claimPendingWebhookEvent,
  finishWebhookEvent,
  getClaimedWebhookEvent,
} from "@/lib/webhooks/event-store";

export type ProcessResult = "succeeded" | "ignored";

function readObjectId(payload: Record<string, unknown>): string | null {
  const value = payload.objectId;
  if (typeof value !== "string" && typeof value !== "number") return null;
  return String(value);
}

/**
 * Process verified provider events after the durable queue has leased the event.
 * Provider failures are converted to safe retry metadata; sensitive payloads
 * and provider response bodies are never written to logs.
 */
export async function processWebhookEvent(eventId: string, alreadyClaimed = false): Promise<ProcessResult> {
  if (!alreadyClaimed) {
    const claimed = await claimPendingWebhookEvent(eventId);
    if (!claimed) return "ignored";
  }

  try {
    const event = await getClaimedWebhookEvent(eventId);
    if (!event) throw new Error("Claimed event could not be loaded");

    if (event.provider === "wix") {
      const normalizedEventType = event.eventType.toLowerCase().replace(/[^a-z]/g, "");
      const isAppInstalled = normalizedEventType.includes("appinstanceinstalled");
      const isAppRemoved = normalizedEventType.includes("appinstanceremoved");

      if (isAppInstalled || isAppRemoved) {
        if (!event.correlationId) {
          await finishWebhookEvent(eventId, "ignored", "MISSING_WIX_INSTANCE_ID");
          return "ignored";
        }

        const db = getSupabaseAdmin();
        if (isAppInstalled) {
          const { error } = await db.from("provider_connections").upsert({
            provider: "wix",
            external_account_id: event.correlationId,
            account_label: null,
            connected_at: new Date().toISOString(),
            disconnected_at: null,
            updated_at: new Date().toISOString(),
          }, { onConflict: "provider,external_account_id" });
          if (error) throw new Error("Unable to register Wix installation");
        } else {
          const { error } = await db.from("provider_connections").update({
            disconnected_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq("provider", "wix").eq("external_account_id", event.correlationId)
            .is("disconnected_at", null);
          if (error) throw new Error("Unable to disconnect Wix installation");
        }

        await finishWebhookEvent(eventId, "succeeded");
        return "succeeded";
      }

      const supported = ["wix.contacts.v4.contact_created", "wix.contacts.v4.contact_updated"];
      if (!supported.includes(event.eventType)) {
        await finishWebhookEvent(eventId, "ignored", "UNSUPPORTED_WIX_EVENT");
        return "ignored";
      }
      const eventData = event.payload.eventData;
      const entityId = eventData && typeof eventData === "object"
        ? (eventData as Record<string, unknown>).entityId
        : undefined;
      if (!event.correlationId || typeof entityId !== "string") {
        await finishWebhookEvent(eventId, "ignored", "MISSING_WIX_CONTACT_ID");
        return "ignored";
      }
      await syncWixContactToHubSpot(event.correlationId, entityId);
      await finishWebhookEvent(eventId, "succeeded");
      return "succeeded";
    }

    if (!["contact.creation", "contact.propertyChange"].includes(event.eventType)) {
      await finishWebhookEvent(eventId, "ignored", "UNSUPPORTED_EVENT");
      return "ignored";
    }

    const hubspotContactId = readObjectId(event.payload);
    if (!hubspotContactId) {
      await finishWebhookEvent(eventId, "ignored", "MISSING_CONTACT_ID");
      return "ignored";
    }

    // A HubSpot connection is not yet explicitly paired to a Wix site.
    // Never send a contact to an arbitrary site when multiple Wix installs exist.
    const { data: wixConnections, error } = await getSupabaseAdmin()
      .from("provider_connections")
      .select("external_account_id")
      .eq("provider", "wix")
      .is("disconnected_at", null)
      .not("external_account_id", "is", null)
      .limit(2);

    if (error) throw new Error("Unable to resolve Wix installation");
    if (!wixConnections?.length) {
      await finishWebhookEvent(eventId, "ignored", "WIX_NOT_CONNECTED");
      return "ignored";
    }
    if (wixConnections.length !== 1 || !wixConnections[0].external_account_id) {
      await finishWebhookEvent(eventId, "ignored", "WIX_INSTALLATION_AMBIGUOUS");
      return "ignored";
    }

    const contact = await getHubSpotContact(hubspotContactId);
    if (!contact.id) throw new Error("HubSpot contact response is incomplete");

    await syncHubSpotContactToWix(
      wixConnections[0].external_account_id as string,
      hubspotContactId,
      contact,
    );
    await finishWebhookEvent(eventId, "succeeded");
    return "succeeded";
  } catch {
    // Do not persist provider response bodies, tokens, or contact data in logs.
    await finishWebhookEvent(eventId, "failed", "EVENT_PROCESSING_FAILED");
    throw new Error("Webhook event processing failed");
  }
}
