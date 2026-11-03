import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { retryTransition } from "@/lib/webhooks/retry-policy";

export type Provider = "wix" | "hubspot";
export type EventStatus = "pending" | "processing" | "succeeded" | "failed" | "ignored";

export interface VerifiedWebhookEvent {
  provider: Provider;
  eventId?: string;
  eventType: string;
  correlationId?: string;
  payload: Record<string, unknown>;
}

export interface PersistedWebhookEvent {
  id: string;
  status: EventStatus;
  duplicate: boolean;
}

export interface ClaimedWebhookEvent {
  id: string;
  provider: Provider;
  eventType: string;
  correlationId: string | null;
  payload: Record<string, unknown>;
  attempts: number;
}

export function stableIdempotencyKey(event: VerifiedWebhookEvent): string {
  const account = event.provider === "wix" ? event.payload.instanceId : event.payload.portalId;
  if (typeof account !== "string" && typeof account !== "number") throw new Error("Webhook account identity is required");
  const scope = `${event.provider}:${account}`;
  if (event.eventId) {
    // HubSpot eventId is not globally unique. Include stable event identity;
    // attemptNumber changes on redelivery and must never participate in the key.
    const identity = event.provider === "hubspot"
      ? [event.eventId, event.eventType, event.correlationId, event.payload.occurredAt,
        event.payload.subscriptionId, event.payload.objectTypeId, event.payload.propertyName, event.payload.propertyValue]
      : [event.eventId];
    return `${scope}:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
  }
  const digest = createHash("sha256")
    .update(JSON.stringify({
      provider: event.provider,
      eventType: event.eventType,
      correlationId: event.correlationId ?? null,
      payload: canonicalPayload(event.payload, event.provider),
    }))
    .digest("hex");
  return `${scope}:sha256:${digest}`;
}

/** Object order and delivery-attempt metadata do not identify a logical event. */
function canonicalPayload(value: unknown, provider: Provider, root = true): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalPayload(item, provider, false));
  if (!value || typeof value !== "object") return value;
  const object = value as Record<string, unknown>;
  // Default string sorting uses UTF-16 order, independent of host locale/ICU.
  return Object.fromEntries(Object.keys(object).sort()
    .filter((key) => !(root && provider === "hubspot" && key === "attemptNumber"))
    .map((key) => [key, canonicalPayload(object[key], provider, false)]));
}

/** Persist only encrypted payloads. Call after provider signature verification. */
export async function persistVerifiedWebhookEvent(
  event: VerifiedWebhookEvent,
): Promise<PersistedWebhookEvent> {
  const idempotencyKey = stableIdempotencyKey(event);
  const db = getSupabaseAdmin();

  const { data, error } = await db.from("webhook_events").insert({
    provider: event.provider,
    provider_event_id: event.eventId ?? null,
    event_type: event.eventType,
    correlation_id: event.correlationId ?? null,
    idempotency_key: idempotencyKey,
    payload_encrypted: encryptToken(JSON.stringify(event.payload)),
    status: "pending",
  }).select("id,status").single();

  if (!error && data) {
    return { id: data.id as string, status: data.status as EventStatus, duplicate: false };
  }

  if (error?.code === "23505") {
    const { data: existing, error: lookupError } = await db
      .from("webhook_events")
      .select("id,status")
      .eq("idempotency_key", idempotencyKey)
      .single();
    if (!lookupError && existing) {
      return { id: existing.id as string, status: existing.status as EventStatus, duplicate: true };
    }
  }

  throw new Error("Unable to persist verified webhook event");
}

/**
 * The database function performs the status transition and attempts increment
 * atomically, so two workers cannot claim the same pending event.
 */
export async function claimPendingWebhookEvent(eventId: string): Promise<number | null> {
  const { data, error } = await getSupabaseAdmin().rpc("claim_webhook_event_lease", {
    p_event_id: eventId,
  });
  if (error) throw new Error("Unable to claim webhook event");
  return typeof data === "number" && Number.isSafeInteger(data) && data > 0 ? data : null;
}

/** Read payload only after this worker has successfully claimed the event. */
export async function getClaimedWebhookEvent(
  eventId: string,
  leaseVersion: number,
): Promise<ClaimedWebhookEvent | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("webhook_events")
    .select("id,provider,event_type,correlation_id,payload_encrypted,attempts,status")
    .eq("id", eventId)
    .eq("status", "processing")
    .eq("lease_version", leaseVersion)
    .maybeSingle();

  if (error) throw new Error("Unable to read claimed webhook event");
  if (!data) return null;
  if (typeof data.payload_encrypted !== "string") {
    throw new Error("Webhook event payload is unavailable");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(decryptToken(data.payload_encrypted));
  } catch {
    throw new Error("Webhook event payload could not be decrypted");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Webhook event payload is malformed");
  }

  return {
    id: data.id as string,
    provider: data.provider as Provider,
    eventType: data.event_type as string,
    correlationId: (data.correlation_id as string | null) ?? null,
    payload: payload as Record<string, unknown>,
    attempts: data.attempts as number,
  };
}

export async function finishWebhookEvent(
  eventId: string,
  outcome: "succeeded" | "failed" | "ignored" | "pending",
  safeErrorCode?: string,
  expectedLeaseVersion?: number,
  retryAfterSeconds?: number | null,
  permanent = false,
): Promise<void> {
  if (!Number.isSafeInteger(expectedLeaseVersion) || !expectedLeaseVersion || expectedLeaseVersion < 1) throw new Error("Webhook lease is required");
  const db = getSupabaseAdmin();
  const { data: current, error: readError } = await db
    .from("webhook_events")
    .select("attempts")
    .eq("id", eventId)
    .eq("status", "processing")
    .eq("lease_version", expectedLeaseVersion)
    .maybeSingle();
  if (readError || !current) throw new Error("Unable to read processing webhook event");

  const transition = retryTransition({ outcome, attempts: Number(current.attempts), permanent, retryAfterSeconds });

  const { data: updated, error } = await db
    .from("webhook_events")
    .update({
      status: outcome,
      processed_at: outcome === "pending" ? null : new Date().toISOString(),
      attempts: transition.attempts,
      terminal: transition.terminal,
      processing_started_at: null,
      next_attempt_at: transition.delaySeconds === null ? null : new Date(Date.now() + transition.delaySeconds * 1000).toISOString(),
      error_code: safeErrorCode ?? null,
    })
    .eq("id", eventId)
    .eq("status", "processing")
    .eq("lease_version", expectedLeaseVersion)
    .select("id").maybeSingle();

  if (error || !updated) throw new Error("Unable to finish webhook event: lease lost");
}
