import "server-only";
import { createVerify } from "node:crypto";

export interface VerifiedWixWebhook {
  eventType: string;
  instanceId: string;
  eventId?: string;
  entityId?: string;
  eventData: Record<string, unknown>;
  envelope: Record<string, unknown>;
}

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

function parseObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Verify Wix's signed JWT and unwrap its two-level webhook envelope. */
export function verifyWixWebhook(input: {
  token: string;
  publicKey: string;
  now?: number;
}): VerifiedWixWebhook | null {
  const parts = input.token.trim().split(".");
  if (parts.length !== 3 || !input.publicKey.trim()) return null;

  const header = decodeSegment(parts[0]);
  const outer = decodeSegment(parts[1]);
  if (!header || header.alg !== "RS256" || !outer) return null;

  const expiresAt = Number(outer.exp);
  const issuedAt = Number(outer.iat);
  const nowSeconds = Math.floor((input.now ?? Date.now()) / 1000);
  if (!Number.isFinite(expiresAt) || expiresAt <= nowSeconds) return null;
  if (Number.isFinite(issuedAt) && issuedAt > nowSeconds + 60) return null;

  try {
    const publicKey = input.publicKey.replace(/\\n/g, "\n");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(parts[0] + "." + parts[1], "ascii");
    verifier.end();
    if (!verifier.verify(publicKey, Buffer.from(parts[2], "base64url"))) return null;
  } catch {
    return null;
  }

  // Wix REST webhooks wrap the event envelope in the outer JWT's data string.
  const envelope = parseObject(outer.data);
  if (!envelope || typeof envelope.eventType !== "string" || typeof envelope.instanceId !== "string") return null;
  const eventData = parseObject(envelope.data);
  if (!eventData) return null;

  return {
    eventType: envelope.eventType,
    instanceId: envelope.instanceId,
    eventId: typeof eventData.id === "string" ? eventData.id : undefined,
    entityId: typeof eventData.entityId === "string" ? eventData.entityId : undefined,
    eventData,
    envelope,
  };
}
