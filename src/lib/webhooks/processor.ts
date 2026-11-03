import "server-only";
import { getHubSpotContact } from "@/lib/providers/hubspot/client";
import { getWixContact } from "@/lib/providers/wix/contacts";
import { syncHubSpotContactToWix, syncWixContactToHubSpot } from "@/lib/sync/engine";
import { syncWixFormSubmissionToHubSpot } from "@/lib/sync/form-submission";
import { listEnabledMappings } from "@/lib/sync/mapping-repository";
import { listSyncTargets, resolveProviderConnections } from "@/lib/sync/connection-repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ProviderApiError } from "@/lib/providers/api-error";
import { isSameSyncEcho } from "@/lib/sync/echo-guard";
import { requestWixInstanceToken } from "@/lib/providers/wix/client";
import { saveProviderConnection } from "@/lib/providers/connections";
import { isHubSpotContactEvent, isWixContactEvent } from "@/lib/webhooks/event-types";
import { logOperationFailure } from "@/lib/security/log";
import { IntegrationBusyError } from "@/lib/sync/lease";
import { ContactReconciliationRequired } from "@/lib/sync/creation-intent";
import { claimPendingWebhookEvent, finishWebhookEvent, getClaimedWebhookEvent, type ClaimedWebhookEvent } from "@/lib/webhooks/event-store";
import { rootFailure, isPermanentFailure } from "@/lib/webhooks/retry-policy";
import { withSyncAuditContext } from "@/lib/sync/audit-context";

export type ProcessResult = "succeeded" | "ignored" | "deferred";
const asId = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : null;

async function processWix(event: ClaimedWebhookEvent): Promise<"succeeded" | "ignored"> {
  const db = getSupabaseAdmin();
  const instanceId = asId(event.payload.instanceId);
  if (!instanceId) throw new Error("Missing Wix instance identity");
  if (event.eventType === "AppRemoved") {
    const result = await db.rpc("apply_wix_removal", { p_event_id: event.id, p_instance_id: instanceId });
    if (result.error) throw new Error("Unable to apply Wix removal");
    return "succeeded";
  }
  const isForm = event.eventType === "wix.forms.v4.submission_created";
  if (event.eventType !== "AppInstalled" && !isWixContactEvent(event.eventType) && !isForm) return "ignored";
  const installation = await db.from("provider_connections").select("id,disconnected_at")
    .eq("provider", "wix").eq("external_account_id", instanceId).maybeSingle();
  if (installation.error) throw new Error("Unable to inspect Wix installation");
  if (installation.data?.disconnected_at) return "ignored";
  if (!installation.data) {
    const token = await requestWixInstanceToken(instanceId);
    await saveProviderConnection({ provider: "wix", externalAccountId: instanceId, accessToken: token.access_token, expiresIn: token.expires_in, onlyIfNew: true });
  }
  if (event.eventType === "AppInstalled") return "succeeded";
  const targets = await listSyncTargets("wix", instanceId);
  const contactId = asId(event.payload.contactId) ?? event.correlationId;
  if (!isForm && !contactId) throw new Error("Missing Wix contact identity");
  let processed = false;
  for (const target of targets) {
    if (isForm) {
      if (!event.payload.data || typeof event.payload.data !== "object" || Array.isArray(event.payload.data)) throw new Error("Malformed form submission");
      await syncWixFormSubmissionToHubSpot(instanceId, event.payload.data as Record<string, unknown>, target.pairId);
    } else {
      const pair = await resolveProviderConnections(instanceId, target.pairId);
      const link = await db.from("contact_links").select("last_source,wix_updated_at")
        .eq("wix_connection_id", pair.wix.id).eq("hubspot_connection_id", pair.hubspot.id).eq("wix_contact_id", contactId!).maybeSingle();
      if (link.error) throw new Error("Unable to inspect Wix sync identity");
      if (link.data?.last_source === "hubspot") {
        const current = await getWixContact(instanceId, contactId!);
        if (isSameSyncEcho(current.updatedDate, link.data.wix_updated_at)) continue;
      }
      await syncWixContactToHubSpot(instanceId, contactId!, target.pairId);
    }
    processed = true;
  }
  return processed ? "succeeded" : "ignored";
}

async function processHubSpot(event: ClaimedWebhookEvent): Promise<"succeeded" | "ignored"> {
  if (!isHubSpotContactEvent(event.eventType, event.payload)) return "ignored";
  const portalId = asId(event.payload.portalId);
  const contactId = asId(event.payload.objectId);
  if (!portalId || !contactId) throw new Error("Missing HubSpot event identity");
  const targets = await listSyncTargets("hubspot", portalId);
  let processed = false;
  for (const target of targets) {
    const pair = await resolveProviderConnections(target.instanceId, target.pairId);
    const mappings = await listEnabledMappings(pair.wix.id, pair.hubspot.id);
    const contact = await getHubSpotContact(contactId, mappings.filter((m) => m.enabled).map((m) => m.targetField), pair.hubspot.id);
    const link = await getSupabaseAdmin().from("contact_links").select("last_source,hubspot_updated_at")
      .eq("wix_connection_id", pair.wix.id).eq("hubspot_connection_id", pair.hubspot.id).eq("hubspot_contact_id", contactId).maybeSingle();
    if (link.error) throw new Error("Unable to inspect HubSpot sync identity");
    if (link.data?.last_source === "wix" && isSameSyncEcho(contact.updatedAt, link.data.hubspot_updated_at)) continue;
    await syncHubSpotContactToWix(target.instanceId, contactId, contact, target.pairId);
    processed = true;
  }
  return processed ? "succeeded" : "ignored";
}

/** Fan out only to explicit pairs. A failed pair leaves the durable event retryable;
 * successful pairs reconcile against links and live versions on the next delivery. */
export async function processWebhookEvent(eventId: string): Promise<ProcessResult> {
  const lease = await claimPendingWebhookEvent(eventId);
  if (!lease) return "ignored";
  let event: ClaimedWebhookEvent | null = null;
  try {
    event = await getClaimedWebhookEvent(eventId, lease);
    if (!event) throw new Error("Claimed event unavailable");
    const claimed = event;
    const result = await withSyncAuditContext({ eventId, attempt: claimed.attempts },
      () => claimed.provider === "wix" ? processWix(claimed) : processHubSpot(claimed));
    if (event.eventType !== "AppRemoved") await finishWebhookEvent(eventId, result, result === "ignored" ? "NO_APPLICABLE_WRITE" : undefined, lease);
    return result;
  } catch (error) {
    const cause = rootFailure(error);
    if (cause instanceof IntegrationBusyError) {
      await finishWebhookEvent(eventId, "pending", "INTEGRATION_BUSY", lease);
      return "deferred";
    }
    const code = cause instanceof ContactReconciliationRequired ? "CONTACT_RECONCILIATION_REQUIRED"
      : cause instanceof ProviderApiError ? `${cause.provider.toUpperCase()}_HTTP_${cause.status}` : "EVENT_PROCESSING_FAILED";
    logOperationFailure(code, { eventId, correlationId: eventId, provider: event?.provider,
      operation: "process_webhook", result: "failed", attempt: event?.attempts,
      status: cause instanceof ProviderApiError ? cause.status : undefined });
    await finishWebhookEvent(eventId, "failed", code, lease, cause instanceof ProviderApiError ? cause.retryAfterSeconds : null, isPermanentFailure(cause));
    throw new Error("Webhook event processing failed");
  }
}
