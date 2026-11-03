import { NextRequest, NextResponse } from "next/server";
import { persistVerifiedWebhookEvent } from "@/lib/webhooks/event-store";
import { verifyHubSpotSignature } from "@/lib/webhooks/hubspot-signature";
import { z } from "zod";
import { readBoundedBody, RequestBodyError } from "@/lib/security/request-body";
import { logOperationFailure } from "@/lib/security/log";

export const runtime = "nodejs";

const identifier = z.union([z.string().min(1).max(256), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]);
const eventSchema = z.object({
  eventId: identifier,
  portalId: identifier,
  objectId: identifier,
  subscriptionType: z.string().min(1).max(120).optional(),
  eventType: z.string().min(1).max(120).optional(),
  occurredAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
}).passthrough().refine((event) => Boolean(event.subscriptionType || event.eventType) &&
  (!event.subscriptionType || !event.eventType || event.subscriptionType === event.eventType));

export async function POST(request: NextRequest) {
  const secret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!secret) return NextResponse.json({ error: "Webhook endpoint is not configured" }, { status: 503 });

  let rawBody: string;
  try { rawBody = await readBoundedBody(request, 1_000_000); }
  catch (error) { return NextResponse.json({ error: "Invalid webhook body" }, { status: error instanceof RequestBodyError ? error.status : 400 }); }
  const valid = verifyHubSpotSignature({
    clientSecret: secret,
    method: request.method,
    requestUrl: request.url,
    rawBody,
    signature: request.headers.get("x-hubspot-signature-v3"),
    timestamp: request.headers.get("x-hubspot-request-timestamp"),
  });
  if (!valid) return NextResponse.json({ error: "Invalid webhook signature" }, { status: 401 });

  let events: z.infer<typeof eventSchema>[];
  try {
    events = z.array(eventSchema).max(100).parse(JSON.parse(rawBody));
  } catch {
    return NextResponse.json({ error: "Invalid webhook payload" }, { status: 400 });
  }

  try {
    const results = await Promise.all(events.map((event) =>
      persistVerifiedWebhookEvent({
        provider: "hubspot",
        eventId: event.eventId == null ? undefined : String(event.eventId),
        eventType: event.subscriptionType ?? event.eventType!,
        correlationId: event.objectId == null ? undefined : String(event.objectId),
        payload: event as Record<string, unknown>,
      })
    ));
    return NextResponse.json({
      accepted: results.length,
      duplicates: results.filter((result) => result.duplicate).length,
    }, { status: 202 });
  } catch {
    logOperationFailure("HUBSPOT_WEBHOOK_PERSIST_FAILED", { provider: "hubspot" });
    return NextResponse.json({ error: "Unable to accept webhook events" }, { status: 500 });
  }
}
