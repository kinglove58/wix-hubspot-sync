import { NextRequest, NextResponse } from "next/server";
import { processWebhookEvent } from "@/lib/webhooks/processor";
import { claimNextWebhookEvents } from "@/lib/webhooks/event-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Worker endpoint is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const supplied = body && typeof body === "object" ? (body as { eventIds?: unknown }).eventIds : undefined;
  if (supplied !== undefined && (
    !Array.isArray(supplied) || supplied.length === 0 || supplied.length > 20 ||
    !supplied.every((id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id))
  )) {
    return NextResponse.json({ error: "eventIds must contain 1–20 event UUIDs" }, { status: 400 });
  }

  let eventIds: string[];
  let preclaimed = false;
  try {
    if (Array.isArray(supplied)) eventIds = supplied as string[];
    else {
      eventIds = await claimNextWebhookEvents(10);
      preclaimed = true;
    }
  } catch {
    return NextResponse.json({ error: "Unable to claim webhook queue" }, { status: 503 });
  }

  if (eventIds.length === 0) {
    return NextResponse.json({ requested: 0, processed: 0, failed: 0, message: "Queue is empty" });
  }

  const results = await Promise.allSettled(eventIds.map((id) => processWebhookEvent(id, preclaimed)));
  const processed = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - processed;
  return NextResponse.json({ requested: eventIds.length, processed, failed, queueMode: preclaimed },
    { status: failed ? 207 : 200 });
}
