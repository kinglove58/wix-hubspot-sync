import "server-only";
import { getServerEnv } from "@/lib/env";

export type CustomerPublicConfig = { enabled: false } | { enabled: true; url: string; publishableKey: string };

/** Decode a legacy key only to reject misconfigured privileged keys. This is
 * configuration validation, never authentication or JWT signature validation. */
export function isPublicSupabaseKey(key: string): boolean {
  if (key.startsWith("sb_publishable_") && key.length > 25) return true;
  try {
    const parts = key.split(".");
    if (parts.length !== 3) return false;
    const payload: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return Boolean(payload && typeof payload === "object" && "role" in payload && payload.role === "anon");
  } catch { return false; }
}

export function getCustomerPublicConfig(): CustomerPublicConfig {
  const env = getServerEnv();
  if (env.CUSTOMER_ACCESS_ENABLED !== "true" || !env.SUPABASE_URL) return { enabled: false };
  const key = (env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!key || key === env.SUPABASE_SECRET_KEY || key === env.SUPABASE_SERVICE_ROLE_KEY || !isPublicSupabaseKey(key)) return { enabled: false };
  const url = new URL(env.SUPABASE_URL);
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) return { enabled: false };
  return { enabled: true, url: url.toString(), publishableKey: key };
}
