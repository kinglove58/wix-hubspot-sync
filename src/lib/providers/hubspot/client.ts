import "server-only";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type Connection = {
  id: string;
  encrypted_access_token: string;
  encrypted_refresh_token: string | null;
  token_expires_at: string | null;
};

async function connection(): Promise<Connection> {
  const { data, error } = await getSupabaseAdmin()
    .from("provider_connections")
    .select("id,encrypted_access_token,encrypted_refresh_token,token_expires_at")
    .eq("provider", "hubspot")
    .is("disconnected_at", null)
    .order("connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) throw new Error("HubSpot is not connected");
  return data as Connection;
}

async function accessToken(row: Connection): Promise<string> {
  const expiry = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  if (expiry > Date.now() + 60_000) return decryptToken(row.encrypted_access_token);
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
  const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HubSpot token refresh failed: ${response.status}`);
  const token = await response.json() as { access_token: string; refresh_token?: string; expires_in: number };
  if (!token.access_token || !token.expires_in) throw new Error("Incomplete HubSpot refresh response");

  const { error } = await getSupabaseAdmin().from("provider_connections").update({
    encrypted_access_token: encryptToken(token.access_token),
    encrypted_refresh_token: token.refresh_token ? encryptToken(token.refresh_token) : row.encrypted_refresh_token,
    token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  if (error) throw new Error("Unable to save refreshed HubSpot credentials");
  return token.access_token;
}

export async function hubspotRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken(await connection());
  const response = await fetch(`https://api.hubapi.com${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HubSpot API request failed: ${response.status}`);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}

export type HubSpotContact = {
  id?: string;
  properties?: Record<string, string | null>;
  createdAt?: string;
  updatedAt?: string;
};

export function getHubSpotContact(id: string) {
  const query = new URLSearchParams({ properties: "email,firstname,lastname,phone,company,website" });
  return hubspotRequest<HubSpotContact>(`/crm/v3/objects/contacts/${encodeURIComponent(id)}?${query}`);
}

export function listHubSpotContacts(after?: string) {
  const query = new URLSearchParams({ limit: "100", properties: "email,firstname,lastname,phone,company,website" });
  if (after) query.set("after", after);
  return hubspotRequest<{ results: HubSpotContact[]; paging?: { next?: { after: string } } }>(`/crm/v3/objects/contacts?${query}`);
}

export function createHubSpotContact(properties: Record<string, string>) {
  return hubspotRequest<HubSpotContact>("/crm/v3/objects/contacts", {
    method: "POST", body: JSON.stringify({ properties }),
  });
}

export function updateHubSpotContact(id: string, properties: Record<string, string>) {
  return hubspotRequest<HubSpotContact>(`/crm/v3/objects/contacts/${encodeURIComponent(id)}`, {
    method: "PATCH", body: JSON.stringify({ properties }),
  });
}

export async function findHubSpotContactByEmail(email: string): Promise<HubSpotContact | null> {
  const result = await hubspotRequest<{ results: HubSpotContact[] }>("/crm/v3/objects/contacts/search", {
    method: "POST",
    body: JSON.stringify({
      filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
      properties: ["email", "firstname", "lastname", "phone", "company"],
      limit: 1,
    }),
  });
  return result.results[0] ?? null;
}
