import { NextRequest, NextResponse } from "next/server";
import { persistVerifiedWebhookEvent } from "@/lib/webhooks/event-store";
import { verifyHubSpotSignature } from "@/lib/webhooks/hubspot-signature";

export const runtime = "nodejs";

type HubSpotEvent = {
  eventId?: number | string;
  subscriptionType?: string;
  objectId?: number | string;
  occurredAt?: number;
  [key: string]: unknown;
};

export async function POST(request: NextRequest) {
  const secret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook endpoint is not configured" }, { status: 503 });

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 1_000_000) return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > 1_000_000) return NextResponse.json({ error: "Webhook payload too large" }, { status: 413 });
  const valid = verifyHubSpotSignature({
    clientSecret: secret,
    method: request.method,
    requestUrl: request.url,
    rawBody,
    signature: request.headers.get("x-hubspot-signature-v3"),
    timestamp: request.headers.get("x-hubspot-request-timestamp"),
  });
  if (!valid) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });

  let events: HubSpotEvent[];
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!Array.isArray(parsed) || parsed.length > 100) throw new Error("Invalid event batch");
    events = parsed as HubSpotEvent[];
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  try {
    const results = await Promise.all(events.map((event) =>
      persistVerifiedWebhookEvent({
        provider: "hubspot",
        eventId: event.eventId == null ? undefined : String(event.eventId),
        eventType: typeof event.subscriptionType === "string" ? event.subscriptionType : "unknown",
        correlationId: event.objectId == null ? undefined : String(event.objectId),
        payload: event as Record<string, unknown>,
      })
    ));
    return NextResponse.json({
      accepted: results.length,
      duplicates: results.filter((result) => result.duplicate).length,
    }, { status: 202 });
  } catch {
    return NextResponse.json({ error: "Unable to accept webhook events" }, { status: 500 });
  }
}
