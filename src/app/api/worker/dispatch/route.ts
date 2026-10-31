import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { processWebhookEvent } from "@/lib/webhooks/processor";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Worker dispatch is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  const now = new Date().toISOString();
  const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const [ready, stale] = await Promise.all([
    db.from("webhook_events").select("id")
      .in("status", ["pending", "failed"]).lt("attempts", 5)
      .or(`next_attempt_at.is.null,next_attempt_at.lte.${now}`)
      .order("received_at", { ascending: true }).limit(5),
    db.from("webhook_events").select("id")
      .eq("status", "processing").lt("processing_started_at", staleBefore)
      .order("received_at", { ascending: true }).limit(5),
  ]);
  if (ready.error || stale.error) return NextResponse.json({ error: "Unable to load queued events" }, { status: 500 });

  const ids = [...new Set([...(ready.data ?? []), ...(stale.data ?? [])].map((item) => item.id as string))].slice(0, 5);
  const results = await Promise.allSettled(ids.map((id) => processWebhookEvent(id)));
  const succeeded = results.filter((result) => result.status === "fulfilled" && result.value === "succeeded").length;
  const ignored = results.filter((result) => result.status === "fulfilled" && result.value === "ignored").length;
  const failed = results.length - succeeded - ignored;

  return NextResponse.json({ requested: ids.length, succeeded, ignored, failed }, { status: failed ? 207 : 200 });
}
