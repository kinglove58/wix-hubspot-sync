import "server-only";

import { createHash } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

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

/**
 * Call only after provider-specific signature verification succeeds.
 * The unique idempotency_key constraint makes concurrent deliveries safe.
 */
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
    status: "pending",
  }).select("id,status").single();

  if (!error && data) {
    return { id: data.id as string, status: data.status as EventStatus, duplicate: false };
  }

  // Postgres unique_violation: the same event was already accepted.
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

export async function claimPendingWebhookEvent(eventId: string): Promise<boolean> {
  const { data, error } = await getSupabaseAdmin()
    .from("webhook_events")
    .update({
      status: "processing",
      attempts: 1,
    })
    .eq("id", eventId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) throw new Error("Unable to claim webhook event");
  return Boolean(data);
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
