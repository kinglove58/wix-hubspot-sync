import "server-only";

import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const WIX_TOKEN_URL = "https://www.wixapis.com/oauth2/token";

export interface WixAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Reuses the encrypted site token while valid and refreshes it using the
 * self-managed app client-credentials flow when it is near expiry.
 */
export async function getWixAccessToken(instanceId: string): Promise<WixAccessToken> {
  const appId = process.env.WIX_APP_ID?.trim();
  const appSecret = process.env.WIX_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("Wix app credentials are not configured");
  if (!instanceId.trim()) throw new Error("Wix app instance ID is required");

  const db = getSupabaseAdmin();
  const { data: connection, error: connectionError } = await db
    .from("provider_connections")
    .select("id,encrypted_access_token,token_expires_at")
    .eq("provider", "wix")
    .eq("external_account_id", instanceId)
    .is("disconnected_at", null)
    .maybeSingle();
  if (connectionError || !connection) throw new Error("Wix site is not connected");

  const expiry = connection.token_expires_at ? Date.parse(connection.token_expires_at) : 0;
  if (connection.encrypted_access_token && expiry > Date.now() + 60_000) {
    return {
      access_token: decryptToken(connection.encrypted_access_token),
      token_type: "Bearer",
      expires_in: Math.floor((expiry - Date.now()) / 1000),
    };
  }

  const response = await fetch(WIX_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
      instance_id: instanceId,
    }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Wix token request failed with status ${response.status}`);

  const token = (await response.json()) as WixAccessToken;
  if (!token.access_token || !token.expires_in) throw new Error("Wix returned an incomplete access token response");

  const { error: updateError } = await db.from("provider_connections").update({
    encrypted_access_token: encryptToken(token.access_token),
    token_expires_at: new Date(Date.now() + token.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", connection.id);
  if (updateError) throw new Error("Unable to securely store refreshed Wix token");
  return token;
}
