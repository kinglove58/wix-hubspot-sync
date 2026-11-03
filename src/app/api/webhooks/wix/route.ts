import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { persistVerifiedWebhookEvent } from "@/lib/webhooks/event-store";
import { verifyAndDecodeWixWebhook, type WixWebhookEvent } from "@/lib/webhooks/wix-signature";
import { readBoundedBody, RequestBodyError } from "@/lib/security/request-body";
import { logOperationFailure } from "@/lib/security/log";

export const runtime = "nodejs";

function contactIdFrom(data: Record<string, unknown>, rawEvent: Record<string, unknown>): string | undefined {
  const contact = data.contact && typeof data.contact === "object"
    ? data.contact as Record<string, unknown> : {};
  // Wix eventData.id is the unique webhook event ID; entityId identifies the contact.
  const candidates = [data.contactId, data.entityId, rawEvent.entityId, contact.id];
  const value = candidates.find((item) => typeof item === "string" || typeof item === "number");
  return value === undefined ? undefined : String(value);
}

export async function POST(request: NextRequest) {
  const publicKey = getServerEnv().WIX_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "Wix webhook verification is not configured" }, { status: 503 });

  let rawJwt: string;
  try { rawJwt = await readBoundedBody(request, 256_000); }
  catch (error) { return NextResponse.json({ error: "Invalid webhook body" }, { status: error instanceof RequestBodyError ? error.status : 400 }); }

  let event: WixWebhookEvent;
  try {
    event = verifyAndDecodeWixWebhook(rawJwt, publicKey);
  } catch {
    return NextResponse.json({ error: "Invalid Wix webhook" }, { status: 401 });
  }

  try {
    // Removal must never request a new token or bootstrap a disconnected site.
    if (event.eventType === "AppRemoved") {
      const result = await persistVerifiedWebhookEvent({
        provider: "wix", eventId: event.eventId, eventType: event.eventType,
        payload: { instanceId: event.instanceId, issuedAt: event.issuedAt ?? null, data: event.data },
      });
      const { error } = await getSupabaseAdmin().rpc("apply_wix_removal", { p_event_id: result.id, p_instance_id: event.instanceId });
      if (error) throw new Error("Unable to disable removed installation");
      return NextResponse.json({ accepted: true, duplicate: result.duplicate });
    }
    const contactId = contactIdFrom(event.data, event.rawEvent);
    const result = await persistVerifiedWebhookEvent({
      provider: "wix",
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: contactId,
      payload: {
        instanceId: event.instanceId,
        issuedAt: event.issuedAt ?? null,
        eventType: event.eventType,
        contactId: contactId ?? null,
        data: event.data,
      },
    });
    return NextResponse.json({ accepted: true, duplicate: result.duplicate }, { status: 200 });
  } catch {
    // Return 5xx for persistence failures so Wix can retry delivery.
    logOperationFailure("WIX_WEBHOOK_PERSIST_FAILED", { provider: "wix" });
    return NextResponse.json({ error: "Unable to persist verified Wix webhook" }, { status: 500 });
  }
}
