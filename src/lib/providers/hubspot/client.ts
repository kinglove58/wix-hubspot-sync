import "server-only";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ProviderApiError, ProviderPreflightError } from "@/lib/providers/api-error";
import { withIntegrationLease, assertIntegrationLease, integrationWorkSignal } from "@/lib/sync/lease";
import { hubSpotContactSchema, hubSpotTokenSchema } from "@/lib/providers/hubspot/schema";
import { z } from "zod";

type Connection = {
  id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
};

async function connection(connectionId?: string): Promise<Connection> {
  let query = getSupabaseAdmin()
    .from("provider_connections")
    .select("id,encrypted_access_token,encrypted_refresh_token,token_expires_at")
    .eq("provider", "hubspot")
    .is("disconnected_at", null);
  if (connectionId) query = query.eq("id", connectionId);
  // Optional IDs are only safe for the single-portal operator metadata view.
  const { data, error } = await query.maybeSingle();
  if (error || !data) throw new Error("HubSpot is not connected");
  return data as Connection;
}

async function accessToken(row: Connection): Promise<string> {
  const expiry = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  if (expiry > Date.now() + 60_000) return decryptToken(row.encrypted_access_token);
  return withIntegrationLease(`hubspot-token:${row.id}`, async () => {
    const latest = await connection(row.id);
    const expiry = latest.token_expires_at ? Date.parse(latest.token_expires_at) : 0;
    if (expiry > Date.now() + 60_000) return decryptToken(latest.encrypted_access_token);
    return refreshAccessToken(latest);
  });
}

async function refreshAccessToken(row: Connection): Promise<string> {
  if (!row.encrypted_refresh_token) throw new Error("HubSpot refresh token is unavailable");

  const clientId = process.env.HUBSPOT_CLIENT_ID;
  const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("HubSpot OAuth credentials are not configured");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: decryptToken(row.encrypted_refresh_token),
  });
  const response = await fetch("https://api.hubapi.com/oauth/2026-03/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let reason: unknown;
    try { reason = await response.json(); } catch { reason = null; }
    if (response.status === 400 && reason && typeof reason === "object" && "error" in reason && reason.error === "invalid_grant") {
      const disabled = await getSupabaseAdmin().from("provider_connections").update({ disconnected_at: new Date().toISOString(),
        encrypted_access_token: null, encrypted_refresh_token: null, updated_at: new Date().toISOString() })
        .eq("id", row.id).eq("encrypted_refresh_token", row.encrypted_refresh_token);
      if (disabled.error) throw new Error("Unable to disable revoked HubSpot credentials");
    }
    throw new ProviderApiError("hubspot", response.status, response.headers.get("retry-after"));
  }
  const token = hubSpotTokenSchema.parse(await response.json());
  if (!token.access_token || !token.expires_in) throw new Error("Incomplete HubSpot refresh response");

  const { data: updated, error } = await getSupabaseAdmin().from("provider_connections").update({
    encrypted_access_token: encryptToken(token.access_token),
    encrypted_refresh_token: token.refresh_token ? encryptToken(token.refresh_token) : row.encrypted_refresh_token,
    token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id).eq("encrypted_refresh_token", row.encrypted_refresh_token)
    .is("disconnected_at", null).select("id").maybeSingle();
  if (error || !updated) throw new Error("Unable to save refreshed HubSpot credentials; connection may be disconnected");
  return token.access_token;
}

export async function hubspotRequest<T>(path: string, init: RequestInit = {}, connectionId?: string): Promise<T> {
  let token: string;
  let row: Connection;
  try { row = await connection(connectionId); token = await accessToken(row); }
  catch (error) { throw new ProviderPreflightError(error); }
  if (init.method && !["GET", "HEAD"].includes(init.method)) await assertIntegrationLease();
  const request = () => fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    cache: "no-store",
    signal: AbortSignal.any([AbortSignal.timeout(15_000), integrationWorkSignal()]),
  });
  let response = await request();
  if (response.status === 401) {
    try { token = await withIntegrationLease(`hubspot-token:${row.id}`, async () => refreshAccessToken(await connection(row.id))); }
    catch (error) { throw new ProviderPreflightError(error); }
    await assertIntegrationLease();
    response = await request();
  }
  if (!response.ok) throw new ProviderApiError("hubspot", response.status, response.headers.get("retry-after"));
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export type HubSpotContact = {
  id?: string;
  properties?: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
};

const CONTACT_PROPERTIES = ["email", "firstname", "lastname", "phone", "mobilephone", "company", "jobtitle", "website", "address", "city", "state", "zip", "country"];

export async function getHubSpotContact(id: string, extraProperties: string[] = [], connectionId?: string) {
  const available = new Set((await listHubSpotContactProperties(connectionId)).map((property) => property.name));
  if (extraProperties.some((property) => !available.has(property))) throw new Error("A configured HubSpot contact property is unavailable");
  const properties = [...new Set([...CONTACT_PROPERTIES.filter((name) => available.has(name)), ...extraProperties])];
  const query = new URLSearchParams({ properties: properties.join(",") });
  return hubSpotContactSchema.parse(await hubspotRequest<unknown>(`/crm/objects/2026-03/contacts/${encodeURIComponent(id)}?${query}`, {}, connectionId));
}

export async function listHubSpotContacts(after?: string, connectionId?: string) {
  const available = new Set((await listHubSpotContactProperties(connectionId)).map((p) => p.name));
  const query = new URLSearchParams({ limit: "100", properties: CONTACT_PROPERTIES.filter((p) => available.has(p)).join(",") });
  if (after) query.set("after", after);
  return z.object({ results: z.array(hubSpotContactSchema), paging: z.object({ next: z.object({ after: z.union([z.string(), z.number()]).transform(String) }).optional() }).optional() })
    .parse(await hubspotRequest<unknown>(`/crm/objects/2026-03/contacts?${query}`, {}, connectionId));
}

async function validateContactProperties(properties: Record<string, string>, connectionId?: string) {
  const available = new Map((await listHubSpotContactProperties(connectionId)).map((property) => [property.name, property]));
  if (Object.keys(properties).some((name) => !available.has(name) || available.get(name)?.modificationMetadata?.readOnlyValue)) {
    throw new Error("A HubSpot contact property is missing or read-only; review field mappings");
  }
}

export async function createHubSpotContact(properties: Record<string, string>, connectionId?: string) {
  try { await validateContactProperties(properties, connectionId); }
  catch (error) { throw new ProviderPreflightError(error); }
  return hubSpotContactSchema.parse(await hubspotRequest<unknown>("/crm/objects/2026-03/contacts", {
    method: "POST", body: JSON.stringify({ properties }),
  }, connectionId));
}

export async function updateHubSpotContact(id: string, properties: Record<string, string>, connectionId?: string, expectedUpdatedAt?: string) {
  await validateContactProperties(properties, connectionId);
  if (expectedUpdatedAt) {
    const current = hubSpotContactSchema.parse(await hubspotRequest<unknown>(`/crm/objects/2026-03/contacts/${encodeURIComponent(id)}`, {}, connectionId));
    if (!current.updatedAt || Date.parse(current.updatedAt) !== Date.parse(expectedUpdatedAt)) throw new ProviderApiError("hubspot", 409, null);
  }
  return hubSpotContactSchema.parse(await hubspotRequest<unknown>(`/crm/objects/2026-03/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify({ properties }),
  }, connectionId));
}

export async function findHubSpotContactByEmail(email: string, connectionId?: string): Promise<HubSpotContact | null> {
  const result = await hubspotRequest<{ results: HubSpotContact[] }>("/crm/objects/2026-03/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["email"],
      limit: 2,
    }),
  }, connectionId);
  const contacts = z.array(hubSpotContactSchema).parse(result.results);
  if (contacts.length > 1) throw new Error("Ambiguous HubSpot email match");
  return contacts[0] ?? null;
}


const FORM_ATTRIBUTION_PROPERTIES = [
  { name: "utm_source", label: "UTM Source" },
  { name: "utm_medium", label: "UTM Medium" },
  { name: "utm_campaign", label: "UTM Campaign" },
  { name: "utm_term", label: "UTM Term" },
  { name: "utm_content", label: "UTM Content" },
  { name: "landing_page_url", label: "Landing Page URL" },
  { name: "lead_referrer", label: "Lead Referrer" },
  { name: "form_submitted_at", label: "Form Submitted At" },
] as const;

/** Ensure the optional attribution properties exist before writing form leads. */
export async function ensureHubSpotFormAttributionProperties(extraProperties: Array<{ name: string; label: string }> = [], connectionId?: string): Promise<void> {
  const existing = new Set((await listHubSpotContactProperties(connectionId)).map((property) => property.name));
  const token = await accessToken(await connection(connectionId));
  const properties = [...FORM_ATTRIBUTION_PROPERTIES, ...extraProperties];
  for (const property of properties) {
    if (existing.has(property.name)) continue;
    await assertIntegrationLease();
    const response = await fetch("https://api.hubapi.com/crm/properties/2026-03/contacts", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name: property.name,
        label: property.label,
        groupName: "contactinformation",
        type: "string",
        fieldType: "text",
        formField: true,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    // A 409 means the property already exists; all other failures are surfaced.
    if (!response.ok && response.status !== 409) {
      throw new ProviderApiError("hubspot", response.status, response.headers.get("retry-after"));
    }
    existing.add(property.name);
  }
}


export async function listHubSpotContactProperties(connectionId?: string): Promise<Array<{ name: string; label: string; type: string; modificationMetadata?: { readOnlyValue?: boolean } }>> {
  const result = await hubspotRequest<{ results: Array<{ name: string; label: string; type: string; modificationMetadata?: { readOnlyValue?: boolean } }> }>(
    "/crm/properties/2026-03/contacts?archived=false", {}, connectionId,
  );
  return result.results ?? [];
}
