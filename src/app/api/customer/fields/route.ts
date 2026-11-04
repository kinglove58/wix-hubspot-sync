import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext, requireOwnedConnection, CustomerAccessError } from "@/lib/security/customer-auth";
import { customerFailure } from "@/lib/security/customer-response";
import { listHubSpotContactProperties } from "@/lib/providers/hubspot/client";
import { wixFields } from "@/lib/sync/field-options";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireTenantContext(request);
    const id = request.nextUrl.searchParams.get("connectionId");
    if (!id) return NextResponse.json({ wixFields, hubspotProperties: [] });
    const connection = await requireOwnedConnection(context, id, "hubspot");
    if (connection.disconnected_at) throw new CustomerAccessError(409, "HubSpot connection is disconnected");
    const properties = await listHubSpotContactProperties(connection.id);
    return NextResponse.json({ wixFields, hubspotProperties: properties.map((property) => ({ value: property.name, label: property.label || property.name })) });
  } catch (error) { return customerFailure(error, "customer_field_discovery"); }
}
