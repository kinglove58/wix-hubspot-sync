import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = getSupabaseAdmin();
    const [pairs, pending, exhausted, oldest] = await Promise.all([
      db.from("integration_pairs").select("id", { count: "exact", head: true }),
      db.from("webhook_events").select("id", { count: "exact", head: true }).in("status", ["pending", "failed"]).eq("terminal", false).lt("attempts", 5),
      db.from("webhook_events").select("id", { count: "exact", head: true }).eq("status", "failed").eq("terminal", true),
      db.from("webhook_events").select("received_at").in("status", ["pending", "failed"]).eq("terminal", false).lt("attempts", 5).order("received_at").limit(1).maybeSingle(),
    ]);
    if (pairs.error || pending.error || exhausted.error || oldest.error) throw new Error("Database readiness unavailable");
    return NextResponse.json({ status: "ok", database: "reachable", configuredPairs: pairs.count ?? 0,
      retryableEvents: pending.count ?? 0, exhaustedEvents: exhausted.count ?? 0,
      oldestRetryableReceivedAt: oldest.data?.received_at ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
