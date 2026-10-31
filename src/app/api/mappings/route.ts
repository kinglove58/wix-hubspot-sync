import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";

export const runtime = "nodejs";

const mappingSchema = z.object({
  wixField: z.string().trim().min(1).max(120),
  hubspotProperty: z.string().trim().min(1).max(120),
  direction: z.enum(["wix_to_hubspot", "hubspot_to_wix", "bidirectional"]),
  transform: z.enum(["none", "trim", "lowercase", "uppercase"]).default("none"),
  enabled: z.boolean().default(true),
});

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const db = getSupabaseAdmin();
  const [{ data: mappings, error }, { data: connections, error: connectionError }] = await Promise.all([
    db.from("field_mappings").select("*").order("created_at", { ascending: true }),
    db.from("provider_connections").select("id,provider,external_account_id,account_label,connected_at,disconnected_at,scopes").is("disconnected_at", null),
  ]);
  if (error || connectionError) return NextResponse.json({ error: "Unable to load integration settings" }, { status: 500 });
  return NextResponse.json({ mappings, connections });
}

export async function PUT(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const payload = z.object({ mappings: z.array(mappingSchema).max(100) }).parse(await request.json());
    const db = getSupabaseAdmin();
    const { data: connections, error: connectionError } = await db.from("provider_connections")
      .select("id,provider").is("disconnected_at", null);
    if (connectionError) throw connectionError;
    const wix = connections?.find((c) => c.provider === "wix");
    const hubspot = connections?.find((c) => c.provider === "hubspot");
    if (!wix || !hubspot) return NextResponse.json({ error: "Connect both Wix and HubSpot before saving mappings" }, { status: 409 });

    const rows = payload.mappings.map((m) => ({
      wix_connection_id: wix.id, hubspot_connection_id: hubspot.id,
      wix_field: m.wixField, hubspot_property: m.hubspotProperty,
      sync_direction: m.direction, transform: m.transform, enabled: m.enabled,
    }));
    const { error: deleteError } = await db.from("field_mappings").delete()
      .eq("wix_connection_id", wix.id).eq("hubspot_connection_id", hubspot.id);
    if (deleteError) throw deleteError;
    if (rows.length) {
      const { error: insertError } = await db.from("field_mappings").insert(rows);
      if (insertError) throw insertError;
    }
    return NextResponse.json({ saved: true, count: rows.length });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid mapping configuration", details: error.flatten() }, { status: 400 });
    return NextResponse.json({ error: "Unable to save mappings" }, { status: 500 });
  }
}
