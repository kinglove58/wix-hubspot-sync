import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext, requireOwnedConnection, CustomerAccessError } from "@/lib/security/customer-auth";
import { customerFailure, readCustomerJson } from "@/lib/security/customer-response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await requireTenantContext(request, true);
    const input = z.object({ wixConnectionId: z.uuid(), hubspotConnectionId: z.uuid() }).safeParse(await readCustomerJson(request));
    if (!input.success) throw new CustomerAccessError(400, "Two valid connection UUIDs are required");
    const wix = await requireOwnedConnection(context, input.data.wixConnectionId, "wix");
    const hubspot = await requireOwnedConnection(context, input.data.hubspotConnectionId, "hubspot");
    if (wix.disconnected_at || hubspot.disconnected_at) throw new CustomerAccessError(409, "Both connections must be active");
    const result = await getSupabaseAdmin().from("integration_pairs").insert({ wix_connection_id: wix.id, hubspot_connection_id: hubspot.id });
    if (result.error) throw new CustomerAccessError(409, "Unable to pair connections; check for an existing pair");
    return NextResponse.json({ paired: true }, { status: 201 });
  } catch (error) { return customerFailure(error, "customer_pair_connections"); }
}
