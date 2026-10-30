import "server-only";
import { createVerify } from "node:crypto";

type WixWebhookClaims = {
  eventType?: unknown;
  instanceId?: unknown;
  eventId?: unknown;
  data?: unknown;
  exp?: unknown;
  iat?: unknown;
  [key: string]: unknown;
};

function decodeSegment(segment: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Verify Wix's signed webhook JWT using the app's Webhooks public key. */
export function verifyWixWebhook(input: {
  token: string;
  publicKey: string;
  now?: number;
}): WixWebhookClaims | null {
  const parts = input.token.trim().split(".");
  if (parts.length !== 3 || !input.publicKey.trim()) return null;

  const header = decodeSegment(parts[0]);
  const claims = decodeSegment(parts[1]) as WixWebhookClaims | null;
  if (!header || header.alg !== "RS256" || !claims) return null;

  const expiresAt = Number(claims.exp);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) return null;
  if (claims.iat !== undefined && Number(claims.iat) > nowSeconds + 60) return null;

  try {
    const publicKey = input.publicKey.replace(/\\n/g, "\n");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(parts[0] + "." + parts[1], "ascii");
    verifier.end();
    if (!verifier.verify(publicKey, Buffer.from(parts[2], "base64url"))) return null;
  } catch {
    return null;
  }

  if (typeof claims.eventType !== "string" || typeof claims.instanceId !== "string") return null;
  return claims;
}
