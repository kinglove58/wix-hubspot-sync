import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";
import { validateMappings } from "@/lib/sync/mapping";
import { resolveProviderConnections } from "@/lib/sync/connection-repository";

export const runtime = "nodejs";

const mappingSchema = z.object({
  wixField: z.string().trim().min(1).max(120).regex(/^info\.[A-Za-z0-9_.]+$/),
  hubspotProperty: z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
  direction: z.enum(["wix_to_hubspot", "hubspot_to_wix", "bidirectional"]),
  transform: z.enum(["none", "trim", "lowercase", "uppercase"]).default("none"),
  enabled: z.boolean().default(true),
  allowEmpty: z.boolean().default(false),
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
    const payload = z.object({ instanceId: z.string().min(1), pairId: z.uuid().optional(), mappings: z.array(mappingSchema).max(100) }).parse(await request.json());
    const mappingPairs = new Set<string>();
    for (const mapping of payload.mappings) {
      const pair = `${mapping.wixField.toLowerCase()}::${mapping.hubspotProperty.toLowerCase()}`;
      if (mappingPairs.has(pair)) return NextResponse.json({ error: "Duplicate Wix-to-HubSpot field pair" }, { status: 400 });
      mappingPairs.add(pair);
    }
    const validationErrors = validateMappings(payload.mappings.map((mapping) => ({
      sourceField: mapping.wixField,
      targetField: mapping.hubspotProperty,
      direction: mapping.direction === "bidirectional" ? "both" : mapping.direction,
      transform: mapping.transform,
      allowEmpty: mapping.allowEmpty,
    })));
    if (validationErrors.length) return NextResponse.json({ error: "Invalid field mappings", details: validationErrors }, { status: 400 });

    const db = getSupabaseAdmin();
    const { wix, hubspot } = await resolveProviderConnections(payload.instanceId, payload.pairId);

    const { error } = await db.rpc("replace_field_mappings", {
      p_wix_id: wix.id, p_hubspot_id: hubspot.id, p_mappings: payload.mappings,
    });
    if (error) throw new Error("Unable to replace mappings atomically");
    return NextResponse.json({ saved: true, count: payload.mappings.length });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "Invalid mapping configuration", details: error.flatten() }, { status: 400 });
    return NextResponse.json({ error: "Unable to save mappings" }, { status: 500 });
  }
}
