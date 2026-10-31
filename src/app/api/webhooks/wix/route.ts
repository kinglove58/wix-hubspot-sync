import { NextRequest, NextResponse } from "next/server";
import { getServerEnv } from "@/lib/env";
import { requestWixInstanceToken } from "@/lib/providers/wix/client";
import { saveProviderConnection } from "@/lib/providers/connections";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { persistVerifiedWebhookEvent } from "@/lib/webhooks/event-store";
import { verifyAndDecodeWixWebhook, type WixWebhookEvent } from "@/lib/webhooks/wix-signature";

export const runtime = "nodejs";

function contactIdFrom(data: Record<string, unknown>, rawEvent: Record<string, unknown>): string | undefined {
  const contact = data.contact && typeof data.contact === "object"
    ? data.contact as Record<string, unknown> : {};
  // Wix eventData.id is the unique webhook event ID; entityId identifies the contact.
  const candidates = [data.contactId, data.entityId, rawEvent.entityId, contact.id, data.id];
  const value = candidates.find((item) => typeof item === "string" || typeof item === "number");
  return value === undefined ? undefined : String(value);
}

export async function POST(request: NextRequest) {
  const publicKey = getServerEnv().WIX_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "Wix webhook verification is not configured" }, { status: 503 });

  const rawJwt = await request.text();
  if (rawJwt.length > 256_000) return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });

  let event: WixWebhookEvent;
  try {
    event = verifyAndDecodeWixWebhook(rawJwt, publicKey);
  } catch {
    return NextResponse.json({ error: "Invalid Wix webhook" }, { status: 401 });
  }

  try {
    // A verified Wix event proves the app is installed. Bootstrap the site
    // connection on first delivery so the user does not need to copy instance IDs.
    const { data: existingConnection, error: connectionError } = await getSupabaseAdmin()
      .from("provider_connections").select("id")
      .eq("provider", "wix").eq("external_account_id", event.instanceId)
      .is("disconnected_at", null).maybeSingle();
    if (connectionError) throw new Error("Unable to inspect Wix connection");
    if (!existingConnection) {
      const token = await requestWixInstanceToken(event.instanceId);
      await saveProviderConnection({
        provider: "wix",
        externalAccountId: event.instanceId,
        accessToken: token.access_token,
        expiresIn: token.expires_in,
        scopes: [],
      });
    }

    const contactId = contactIdFrom(event.data, event.rawEvent);
    const result = await persistVerifiedWebhookEvent({
      provider: "wix",
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: contactId,
      payload: {
        instanceId: event.instanceId,
        eventType: event.eventType,
        contactId: contactId ?? null,
        data: event.data,
      },
    });
    return NextResponse.json({ accepted: true, duplicate: result.duplicate }, { status: 200 });
  } catch {
    // Return 5xx for persistence failures so Wix can retry delivery.
    return NextResponse.json({ error: "Unable to persist verified Wix webhook" }, { status: 500 });
  }
}
