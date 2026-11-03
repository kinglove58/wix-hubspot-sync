import { NextRequest, NextResponse } from "next/server";
import { processWebhookEvent } from "@/lib/webhooks/processor";
import { z } from "zod";
import { withIntegrationWorkBudget } from "@/lib/sync/lease";

export const runtime = "nodejs";
export const maxDuration = 300;

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

  const parsed = z.object({ eventIds: z.array(z.uuid()).min(1).max(20) }).safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "eventIds must contain 1–20 event UUIDs" }, { status: 400 });
  }

  const eventIds = [...new Set(parsed.data.eventIds)];
  const results: PromiseSettledResult<Awaited<ReturnType<typeof processWebhookEvent>>>[] = [];
  const started = Date.now();
  await withIntegrationWorkBudget(async () => {
    for (const id of eventIds) {
      if (Date.now() - started >= 225_000) break;
      results.push(...await Promise.allSettled([processWebhookEvent(id)]));
    }
  });
  const processed = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - processed;

  return NextResponse.json({
    requested: eventIds.length,
    attempted: results.length,
    processed,
    failed,
  }, { status: failed ? 207 : 200 });
}
