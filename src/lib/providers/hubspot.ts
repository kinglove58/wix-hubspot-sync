import "server-only";

const HUBSPOT_API = "https://api.hubapi.com";

export interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

async function hubspotRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${HUBSPOT_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HubSpot API ${response.status}: ${body.slice(0, 500)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function exchangeHubSpotCode(code: string, redirectUri: string, clientId: string, clientSecret: string) {
  const body = new URLSearchParams({
    grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret,
    redirect_uri: redirectUri, code,
  });
  const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store",
  });
  if (!response.ok) throw new Error(`HubSpot token exchange failed (${response.status})`);
  return response.json() as Promise<HubSpotTokenResponse>;
}

export async function refreshHubSpotToken(refreshToken: string, clientId: string, clientSecret: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token", client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken,
  });
  const response = await fetch("https://api.hubapi.com/oauth/v1/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, cache: "no-store",
  });
  if (!response.ok) throw new Error(`HubSpot token refresh failed (${response.status})`);
  return response.json() as Promise<HubSpotTokenResponse>;
}

export async function getHubSpotAccountId(token: string): Promise<string> {
  const response = await fetch("https://api.hubapi.com/oauth/v1/access-tokens/" + encodeURIComponent(token), { cache: "no-store" });
  if (!response.ok) throw new Error("Unable to identify the authorized HubSpot account");
  const data = await response.json() as { hub_id?: number | string };
  if (!data.hub_id) throw new Error("HubSpot did not return an account ID");
  return String(data.hub_id);
}

export interface HubSpotContact {
  id?: string;
  properties?: Record<string, string | null>;
  updatedAt?: string;
}

export async function upsertHubSpotContact(token: string, properties: Record<string, unknown>, existingId?: string) {
  const clean = Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => [key, String(value)]));
  if (existingId) {
    return hubspotRequest<HubSpotContact>(token, `/crm/v3/objects/contacts/${encodeURIComponent(existingId)}`, {
      method: "PATCH", body: JSON.stringify({ properties: clean }),
    });
  }
  return hubspotRequest<HubSpotContact>(token, "/crm/v3/objects/contacts", {
    method: "POST", body: JSON.stringify({ properties: clean }),
  });
}

export async function getHubSpotContact(token: string, id: string) {
  return hubspotRequest<HubSpotContact>(token, `/crm/v3/objects/contacts/${encodeURIComponent(id)}?properties=email,firstname,lastname,phone`);
}
