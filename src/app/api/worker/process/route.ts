import { NextRequest, NextResponse } from "next/server";
import { processWebhookEvent } from "@/lib/webhooks/processor";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Worker endpoint is not configured" }, { status: 503 });
  }

  const authorization = request.headers.get("authorization");
  if (authorization !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    !body ||
    typeof body !== "object" ||
    !Array.isArray((body as { eventIds?: unknown }).eventIds) ||
    (body as { eventIds: unknown[] }).eventIds.length < 1 ||
    (body as { eventIds: unknown[] }).eventIds.length > 20 ||
    !(body as { eventIds: unknown[] }).eventIds.every(
      (id) => typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id),
    )
  ) {
    return NextResponse.json({ error: "eventIds must contain 1–20 event UUIDs" }, { status: 400 });
  }

  const eventIds = (body as { eventIds: string[] }).eventIds;
  const results = await Promise.allSettled(eventIds.map((id) => processWebhookEvent(id)));
  const processed = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - processed;

  return NextResponse.json({
    requested: eventIds.length,
    processed,
    failed,
  }, { status: failed ? 207 : 200 });
}
