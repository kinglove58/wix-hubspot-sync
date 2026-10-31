import "server-only";
import { createVerify } from "node:crypto";

export interface WixWebhookEvent {
  instanceId: string;
  eventType: string;
  eventId?: string;
  data: Record<string, unknown>;
  rawEvent: Record<string, unknown>;
}

/** Wix self-managed webhook bodies are RS256-signed JWTs, not ordinary JSON. */
export function verifyAndDecodeWixWebhook(
  jwt: string,
  publicKey: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): WixWebhookEvent {
  const parts = jwt.trim().split(".");
  if (parts.length !== 3 || !publicKey.trim()) throw new Error("Malformed Wix webhook JWT");

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8")) as { alg?: string };
  if (header.alg !== "RS256") throw new Error("Unsupported Wix webhook signature algorithm");

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();
  const pem = publicKey.replace(/\\n/g, "\n");
  const signatureValid = verifier.verify(pem, Buffer.from(encodedSignature, "base64url"));
  if (!signatureValid) throw new Error("Invalid Wix webhook signature");

  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    iat?: number; exp?: number; instanceId?: string; eventType?: string; data?: unknown; eventId?: string;
  };
  if (!claims.exp || claims.exp <= nowSeconds) throw new Error("Expired Wix webhook");
  if (claims.iat && claims.iat > nowSeconds + 60) throw new Error("Wix webhook issued in the future");
  if (!claims.instanceId || !claims.eventType || claims.data === undefined) {
    throw new Error("Incomplete Wix webhook claims");
  }

  const rawEvent = typeof claims.data === "string"
    ? JSON.parse(claims.data) as Record<string, unknown>
    : claims.data as Record<string, unknown>;
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    throw new Error("Malformed Wix event data");
  }

  const innerData = typeof rawEvent.data === "string"
    ? JSON.parse(rawEvent.data) as Record<string, unknown>
    : (rawEvent.data && typeof rawEvent.data === "object" ? rawEvent.data : rawEvent);
  if (!innerData || typeof innerData !== "object" || Array.isArray(innerData)) {
    throw new Error("Malformed Wix event entity");
  }

  return {
    instanceId: claims.instanceId,
    eventType: claims.eventType,
    eventId: claims.eventId ?? (typeof rawEvent.id === "string" ? rawEvent.id : undefined),
    data: innerData,
    rawEvent,
  };
}
