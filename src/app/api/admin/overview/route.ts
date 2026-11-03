import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getSupabaseAdmin();
  const [connections, mappings, events, audit, pairs] = await Promise.all([
    db.from("provider_connections")
      .select("id,provider,external_account_id,account_label,connected_at,disconnected_at,scopes")
      .is("disconnected_at", null),
    db.from("field_mappings").select("id,wix_connection_id,hubspot_connection_id,wix_field,hubspot_property,sync_direction,transform,enabled,allow_empty").order("created_at", { ascending: true }),
    db.from("webhook_events").select("id,provider,event_type,status,attempts,received_at,processed_at,error_code").order("received_at", { ascending: false }).limit(20),
    db.from("sync_audit_logs").select("id,provider,action,outcome,created_at,safe_details").order("created_at", { ascending: false }).limit(20),
    db.from("integration_pairs").select("id,wix_connection_id,hubspot_connection_id,use_default_mappings"),
  ]);
  if (connections.error || mappings.error || events.error || audit.error || pairs.error) {
    return NextResponse.json({ error: "Unable to load dashboard data" }, { status: 500 });
  }
  return NextResponse.json({
    connections: connections.data ?? [],
    pairs: pairs.data ?? [],
    mappings: mappings.data ?? [],
    recentEvents: events.data ?? [],
    recentActivity: audit.data ?? [],
  });
}
