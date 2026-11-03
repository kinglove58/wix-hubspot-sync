import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { listHubSpotContactProperties } from "@/lib/providers/hubspot/client";

export const runtime = "nodejs";

const wixFields = [
  { value: "info.name.first", label: "First name" },
  { value: "info.name.last", label: "Last name" },
  { value: "info.emails.items.0.email", label: "First email entry" },
  { value: "info.phones.items.0.phone", label: "First phone entry" },
  { value: "info.company", label: "Company" },
  { value: "info.birthdate", label: "Birth date" },
  { value: "info.jobTitle", label: "Job title" },
  { value: "info.addresses.items.0.address.addressLine", label: "Address line" },
  { value: "info.addresses.items.0.address.city", label: "City" },
  { value: "info.addresses.items.0.address.postalCode", label: "Postal code" },
  { value: "info.addresses.items.0.address.subdivision", label: "State or region code" },
  { value: "info.addresses.items.0.address.country", label: "Country code" },
];

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: connection, error } = await getSupabaseAdmin().from("provider_connections")
    .select("id").eq("provider", "hubspot").is("disconnected_at", null)
    .eq("id", request.nextUrl.searchParams.get("connectionId") ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load provider metadata" }, { status: 500 });

  let hubspotProperties: Array<{ value: string; label: string }> = [
    { value: "email", label: "Email" },
    { value: "firstname", label: "First name" },
    { value: "lastname", label: "Last name" },
    { value: "phone", label: "Phone" },
    { value: "company", label: "Company" },
    { value: "website", label: "Website" },
  ];
  if (connection) {
    try {
      const properties = await listHubSpotContactProperties(connection.id);
      hubspotProperties = properties
        .filter((property) => Boolean(property.name))
        .map((property) => ({ value: property.name, label: property.label || property.name }));
    } catch {
      return NextResponse.json({ error: "HubSpot property discovery failed" }, { status: 502 });
    }
  }

  return NextResponse.json({ wixFields, hubspotProperties });
}
