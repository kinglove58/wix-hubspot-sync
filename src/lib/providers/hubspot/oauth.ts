import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { encryptToken } from "@/lib/security/token-crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const HUBSPOT_AUTHORIZE_URL = "https://app.hubspot.com/oauth/authorize";
const HUBSPOT_TOKEN_URL = "https://api.hubspot.com/oauth/v3/token";

function required(value: string | undefined, name: string): string {
  if (!value?.trim()) throw new Error(`${name} is not configured`);
  return value.trim();
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function safeCompareState(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function buildHubSpotAuthorizationUrl(state: string): string {
  const clientId = required(process.env.HUBSPOT_CLIENT_ID, "HUBSPOT_CLIENT_ID");
  const redirectUri = required(process.env.HUBSPOT_REDIRECT_URI, "HUBSPOT_REDIRECT_URI");
  const scopes = (process.env.HUBSPOT_SCOPES ??
    "crm.objects.contacts.read crm.objects.contacts.write crm.schemas.contacts.read crm.schemas.contacts.write").trim();

  const url = new URL(HUBSPOT_AUTHORIZE_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes);
  url.searchParams.set("state", state);
  return url.toString();
}

interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  hub_id: number;
  token_type: string;
  scopes?: string[];
}

export async function exchangeHubSpotCode(code: string): Promise<void> {
  const clientId = required(process.env.HUBSPOT_CLIENT_ID, "HUBSPOT_CLIENT_ID");
  const clientSecret = required(process.env.HUBSPOT_CLIENT_SECRET, "HUBSPOT_CLIENT_SECRET");
  const redirectUri = required(process.env.HUBSPOT_REDIRECT_URI, "HUBSPOT_REDIRECT_URI");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  const response = await fetch(HUBSPOT_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HubSpot token exchange failed with status ${response.status}`);
  }

  const token = (await response.json()) as HubSpotTokenResponse;
  if (!token.access_token || !token.refresh_token || !token.hub_id || !token.expires_in) {
    throw new Error("HubSpot returned an incomplete OAuth token response");
  }

  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("provider_connections").upsert(
    {
      provider: "hubspot",
      external_account_id: String(token.hub_id),
      account_label: `HubSpot portal ${token.hub_id}`,
      encrypted_access_token: encryptToken(token.access_token),
      encrypted_refresh_token: encryptToken(token.refresh_token),
      token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
      scopes: token.scopes ?? [],
      connected_at: new Date().toISOString(),
      disconnected_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,external_account_id" },
  );

  if (error) throw new Error("Unable to securely store HubSpot connection");
}
