import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext } from "@/lib/security/customer-auth";
import { customerFailure } from "@/lib/security/customer-response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireTenantContext(request);
    const db = getSupabaseAdmin();
    const connections = await db.from("provider_connections")
      .select("id,provider,external_account_id,account_label,connected_at,disconnected_at,scopes")
      .eq("tenant_id", context.tenantId);
    if (connections.error) throw new Error("Connection storage unavailable");
    const owned = connections.data ?? [];
    const wix = owned.filter((connection) => connection.provider === "wix");
    const hubspot = owned.filter((connection) => connection.provider === "hubspot");
    const wixIds = wix.map((connection) => connection.id), hubspotIds = hubspot.map((connection) => connection.id);
    const hasPair = wixIds.length > 0 && hubspotIds.length > 0;
    const empty = Promise.resolve({ data: [], error: null });
    const [pairs, mappings, audit, wixEvents, hubspotEvents] = await Promise.all([
      hasPair ? db.from("integration_pairs").select("id,wix_connection_id,hubspot_connection_id,use_default_mappings")
        .in("wix_connection_id", wixIds).in("hubspot_connection_id", hubspotIds) : empty,
      hasPair ? db.from("field_mappings").select("id,wix_connection_id,hubspot_connection_id,wix_field,hubspot_property,sync_direction,transform,enabled,allow_empty")
        .in("wix_connection_id", wixIds).in("hubspot_connection_id", hubspotIds).order("created_at", { ascending: true }) : empty,
      hasPair ? db.from("sync_audit_logs").select("id,provider,action,outcome,created_at,safe_details")
        .in("wix_connection_id", wixIds).in("hubspot_connection_id", hubspotIds).order("created_at", { ascending: false }).limit(20) : empty,
      wix.length ? db.from("webhook_events").select("id,provider,event_type,status,attempts,received_at,error_code")
        .eq("provider", "wix").in("external_account_id", wix.map((connection) => connection.external_account_id)).order("received_at", { ascending: false }).limit(20) : empty,
      hubspot.length ? db.from("webhook_events").select("id,provider,event_type,status,attempts,received_at,error_code")
        .eq("provider", "hubspot").in("external_account_id", hubspot.map((connection) => connection.external_account_id)).order("received_at", { ascending: false }).limit(20) : empty,
    ]);
    if ([pairs, mappings, audit, wixEvents, hubspotEvents].some((result) => result.error)) throw new Error("Integration storage unavailable");
    return NextResponse.json({
      role: context.role, connections: owned, pairs: pairs.data ?? [], mappings: mappings.data ?? [], recentActivity: audit.data ?? [],
      recentEvents: [...(wixEvents.data ?? []), ...(hubspotEvents.data ?? [])]
        .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at)).slice(0, 20),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return customerFailure(error, "customer_overview"); }
}
