import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getSupabaseAdmin();
  const [connections, mappings, events, audit] = await Promise.all([
    db.from("provider_connections")
      .select("id,provider,external_account_id,account_label,connected_at,disconnected_at,scopes")
      .is("disconnected_at", null),
    db.from("field_mappings").select("id,wix_field,hubspot_property,sync_direction,transform,enabled").order("created_at", { ascending: true }),
    db.from("webhook_events").select("id,provider,event_type,status,attempts,received_at,processed_at,error_code").order("received_at", { ascending: false }).limit(20),
    db.from("sync_audit_logs").select("id,provider,action,outcome,created_at,safe_details").order("created_at", { ascending: false }).limit(20),
  ]);
  if (connections.error || mappings.error || events.error || audit.error) {
    return NextResponse.json({ error: "Unable to load dashboard data" }, { status: 500 });
  }
  return NextResponse.json({
    connections: connections.data ?? [],
    mappings: mappings.data ?? [],
    recentEvents: events.data ?? [],
    recentActivity: audit.data ?? [],
  });
}
