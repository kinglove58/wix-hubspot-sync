import { NextRequest, NextResponse } from "next/server";
import { persistVerifiedWebhookEvent } from "@/lib/webhooks/event-store";
import { verifyWixWebhook } from "@/lib/webhooks/wix-signature";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const publicKey = process.env.WIX_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "Wix webhook endpoint is not configured" }, { status: 503 });

  const rawBody = await request.text();
  const event = verifyWixWebhook({ token: rawBody, publicKey });
  if (!event) return NextResponse.json({ error: "Invalid Wix webhook signature or payload" }, { status: 401 });

  try {
    const result = await persistVerifiedWebhookEvent({
      provider: "wix",
      eventId: event.eventId,
      eventType: event.eventType,
      correlationId: event.instanceId,
      payload: {
        eventType: event.eventType,
        instanceId: event.instanceId,
        eventData: event.eventData,
      },
    });
    return NextResponse.json({ accepted: true, duplicate: result.duplicate }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Unable to accept Wix webhook" }, { status: 500 });
  }
}
