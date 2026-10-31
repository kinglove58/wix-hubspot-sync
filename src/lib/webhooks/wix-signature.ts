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
  if (!verifier.verify(pem, Buffer.from(encodedSignature, "base64url"))) {
    throw new Error("Invalid Wix webhook signature");
  }

  const claims = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
    iat?: number; exp?: number; data?: unknown;
  };
  if (!claims.exp || claims.exp <= nowSeconds) throw new Error("Expired Wix webhook");
  if (claims.iat && claims.iat > nowSeconds + 60) throw new Error("Wix webhook issued in the future");
  if (claims.data === undefined) throw new Error("Wix webhook data is missing");

  // Wix places the event object inside the JWT's data claim. The event object
  // itself contains instanceId, eventType and a JSON-encoded data property.
  const rawEvent = typeof claims.data === "string"
    ? JSON.parse(claims.data) as Record<string, unknown>
    : claims.data as Record<string, unknown>;
  if (!rawEvent || typeof rawEvent !== "object" || Array.isArray(rawEvent)) {
    throw new Error("Malformed Wix event data");
  }

  const instanceId = typeof rawEvent.instanceId === "string" ? rawEvent.instanceId : "";
  const eventType = typeof rawEvent.eventType === "string" ? rawEvent.eventType : "";
  if (!instanceId || !eventType) throw new Error("Wix event identity is missing");

  const innerData = typeof rawEvent.data === "string"
    ? JSON.parse(rawEvent.data) as Record<string, unknown>
    : (rawEvent.data && typeof rawEvent.data === "object" ? rawEvent.data : rawEvent);
  if (!innerData || typeof innerData !== "object" || Array.isArray(innerData)) {
    throw new Error("Malformed Wix event entity");
  }

  return {
    instanceId,
    eventType,
    eventId: typeof innerData.id === "string" ? innerData.id
      : typeof rawEvent.eventId === "string" ? rawEvent.eventId : undefined,
    data: innerData,
    rawEvent,
  };
}
