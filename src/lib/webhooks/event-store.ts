import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";

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

function stableIdempotencyKey(event: VerifiedWebhookEvent): string {
  if (event.eventId) return `${event.provider}:${event.eventId}`;
  const digest = createHash("sha256")
    .update(JSON.stringify({
      provider: event.provider,
      eventType: event.eventType,
      correlationId: event.correlationId ?? null,
      payload: event.payload,
    }))
    .digest("hex");
  return `${event.provider}:sha256:${digest}`;
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
export async function claimPendingWebhookEvent(eventId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin().rpc("claim_webhook_event", {
    p_event_id: eventId,
  });
  if (error) throw new Error("Unable to claim webhook event");
  return data === true;
}

/** Read payload only after this worker has successfully claimed the event. */
export async function getClaimedWebhookEvent(
  eventId: string,
): Promise<ClaimedWebhookEvent | null> {
  const { data, error } = await getSupabaseAdmin()
    .from("webhook_events")
    .select("id,provider,event_type,correlation_id,payload_encrypted,attempts,status")
    .eq("id", eventId)
    .eq("status", "processing")
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
  outcome: "succeeded" | "failed" | "ignored",
  safeErrorCode?: string,
): Promise<void> {
  const { error } = await getSupabaseAdmin()
    .from("webhook_events")
    .update({
      status: outcome,
      processed_at: new Date().toISOString(),
      error_code: safeErrorCode ?? null,
    })
    .eq("id", eventId)
    .eq("status", "processing");

  if (error) throw new Error("Unable to update webhook event status");
}
