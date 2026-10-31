import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { listHubSpotContactProperties } from "@/lib/providers/hubspot/client";

export const runtime = "nodejs";

const wixFields = [
  { value: "info.name.first", label: "First name" },
  { value: "info.name.last", label: "Last name" },
  { value: "info.emails.0.email", label: "Primary email" },
  { value: "info.phones.0.phone", label: "Primary phone" },
  { value: "info.company", label: "Company" },
  { value: "info.birthdate", label: "Birth date" },
  { value: "info.addresses.0.addressLine", label: "Address line" },
  { value: "info.addresses.0.city", label: "City" },
  { value: "info.addresses.0.postalCode", label: "Postal code" },
];

export async function GET(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data: connection, error } = await getSupabaseAdmin().from("provider_connections")
    .select("id").eq("provider", "hubspot").is("disconnected_at", null).limit(1).maybeSingle();
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
      const properties = await listHubSpotContactProperties();
      hubspotProperties = properties
        .filter((property) => Boolean(property.name))
        .map((property) => ({ value: property.name, label: property.label || property.name }));
    } catch {
      // Keep the standard property suggestions available if HubSpot is temporarily unavailable.
    }
  }

  return NextResponse.json({ wixFields, hubspotProperties });
}
