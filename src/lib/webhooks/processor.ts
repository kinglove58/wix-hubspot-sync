import "server-only";

import { getHubSpotContact } from "@/lib/providers/hubspot/client";
import { syncHubSpotContactToWix } from "@/lib/sync/engine";
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
 * First worker implementation: process HubSpot contact create/property-change
 * events. Wix events remain safely queued until Wix signature validation and
 * installation lifecycle registration are implemented.
 */
export async function processWebhookEvent(eventId: string): Promise<ProcessResult> {
  const claimed = await claimPendingWebhookEvent(eventId);
  if (!claimed) return "ignored";

  try {
    const event = await getClaimedWebhookEvent(eventId);
    if (!event) throw new Error("Claimed event could not be loaded");

    if (
      event.provider !== "hubspot" ||
      !["contact.creation", "contact.propertyChange"].includes(event.eventType)
    ) {
      await finishWebhookEvent(eventId, "ignored", "UNSUPPORTED_EVENT");
      return "ignored";
    }

    const hubspotContactId = readObjectId(event.payload);
    if (!hubspotContactId) {
      await finishWebhookEvent(eventId, "ignored", "MISSING_CONTACT_ID");
      return "ignored";
    }

    const { data: wixConnection, error } = await getSupabaseAdmin()
      .from("provider_connections")
      .select("external_account_id")
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

    const contact = await getHubSpotContact(hubspotContactId);
    if (!contact.id) throw new Error("HubSpot contact response is incomplete");

    await syncHubSpotContactToWix(
      wixConnection.external_account_id as string,
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
