import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const input = z.object({ wixConnectionId: z.uuid(), hubspotConnectionId: z.uuid() }).parse(await request.json());
    // Insert only. Re-pairing requires an explicit migration/reconciliation of existing links.
    const { error } = await getSupabaseAdmin().from("integration_pairs").insert({
      wix_connection_id: input.wixConnectionId, hubspot_connection_id: input.hubspotConnectionId,
    });
    if (error) return NextResponse.json({ error: "Unable to pair active Wix and HubSpot connections; check for an existing identical pair" }, { status: 409 });
    return NextResponse.json({ paired: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Two valid connection UUIDs are required" }, { status: 400 });
  }
}
