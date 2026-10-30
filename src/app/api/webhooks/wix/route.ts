import { NextRequest, NextResponse } from "next/server";
import { persistVerifiedWebhookEvent } from "@/lib/webhooks/event-store";
import { verifyWixWebhook } from "@/lib/webhooks/wix-signature";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const publicKey = process.env.WIX_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) return NextResponse.json({ error: "Wix webhook endpoint is not configured" }, { status: 503 });

  const rawBody = await request.text();
  const claims = verifyWixWebhook({ token: rawBody, publicKey });
  if (!claims) return NextResponse.json({ error: "Invalid Wix webhook signature" }, { status: 401 });

  try {
    const result = await persistVerifiedWebhookEvent({
      provider: "wix",
      eventId: claims.eventId == null ? undefined : String(claims.eventId),
      eventType: claims.eventType as string,
      correlationId: claims.instanceId as string,
      payload: claims as Record<string, unknown>,
    });
    return NextResponse.json({ accepted: true, duplicate: result.duplicate }, { status: 200 });
  } catch {
    return NextResponse.json({ error: "Unable to accept Wix webhook" }, { status: 500 });
  }
}
