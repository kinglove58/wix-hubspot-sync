import "server-only";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getServerEnv, requireEnv } from "@/lib/env";

export type Provider = "wix" | "hubspot";

export async function saveProviderConnection(input: {
  provider: Provider; externalAccountId: string; accountLabel?: string | null;
  accessToken: string; refreshToken?: string | null; expiresIn?: number; scopes?: string[];
}) {
  const supabase = getSupabaseAdmin();
  const expiresAt = input.expiresIn ? new Date(Date.now() + input.expiresIn * 1000).toISOString() : null;
  const { data, error } = await supabase.from("provider_connections").upsert({
    provider: input.provider,
    external_account_id: input.externalAccountId,
    account_label: input.accountLabel ?? null,
    encrypted_access_token: encryptToken(input.accessToken),
    encrypted_refresh_token: input.refreshToken ? encryptToken(input.refreshToken) : null,
    token_expires_at: expiresAt,
    scopes: input.scopes ?? [],
    connected_at: new Date().toISOString(),
    disconnected_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "provider,external_account_id" }).select("id,provider,external_account_id,account_label,token_expires_at,scopes").single();
  if (error) throw new Error("Unable to save provider connection");
  return data;
}

export async function getProviderConnection(provider: Provider, externalAccountId?: string) {
  const supabase = getSupabaseAdmin();
  let query = supabase.from("provider_connections").select("*").eq("provider", provider).is("disconnected_at", null);
  if (externalAccountId) query = query.eq("external_account_id", externalAccountId);
  const { data, error } = await query.order("connected_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error("Unable to load provider connection");
  if (!data) return null;
  return {
    ...data,
    accessToken: data.encrypted_access_token ? decryptToken(data.encrypted_access_token) : null,
    refreshToken: data.encrypted_refresh_token ? decryptToken(data.encrypted_refresh_token) : null,
  };
}

export async function disconnectProvider(provider: Provider, externalAccountId: string) {
  const current = await getProviderConnection(provider, externalAccountId);
  if (provider === "hubspot" && current?.refreshToken) {
    const env = getServerEnv();
    const body = new URLSearchParams({
      client_id: requireEnv("HUBSPOT_CLIENT_ID", env.HUBSPOT_CLIENT_ID),
      client_secret: requireEnv("HUBSPOT_CLIENT_SECRET", env.HUBSPOT_CLIENT_SECRET),
      token: current.refreshToken,
      token_type_hint: "refresh_token",
    });
    const response = await fetch("https://api.hubspot.com/oauth/2026-03/token/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    if (!response.ok) throw new Error("HubSpot token revocation failed; local credentials were retained");
  }

  const { error } = await getSupabaseAdmin().from("provider_connections").update({
    disconnected_at: new Date().toISOString(), encrypted_access_token: null, encrypted_refresh_token: null,
    updated_at: new Date().toISOString(),
  }).eq("provider", provider).eq("external_account_id", externalAccountId);
  if (error) throw new Error("Unable to disconnect provider");
}
