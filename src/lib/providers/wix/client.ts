import "server-only";

const WIX_TOKEN_URL = "https://www.wixapis.com/oauth2/token";

export interface WixAccessToken {
  access_token: string;
  token_type: string;
  expires_in: number;
}

/**
 * Wix self-managed apps obtain a site-scoped access token with the app
 * credentials and the installed app instance ID. Keep all values server-side.
 */
export async function getWixAccessToken(instanceId: string): Promise<WixAccessToken> {
  const appId = process.env.WIX_APP_ID?.trim();
  const appSecret = process.env.WIX_APP_SECRET?.trim();
  if (!appId || !appSecret) throw new Error("Wix app credentials are not configured");
  if (!instanceId.trim()) throw new Error("Wix app instance ID is required");

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

  if (!response.ok) {
    throw new Error(`Wix token request failed with status ${response.status}`);
  }

  const token = (await response.json()) as WixAccessToken;
  if (!token.access_token || !token.expires_in) {
    throw new Error("Wix returned an incomplete access token response");
  }
  return token;
}
