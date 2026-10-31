import { generateKeyPairSync, createSign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAndDecodeWixWebhook } from "../src/lib/webhooks/wix-signature";

function signedEvent(privateKey: string, payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${body}`);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64url");
  return `${header}.${body}.${signature}`;
}

describe("Wix webhook JWT verification", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("verifies Wix's signed body and decodes the contact event", () => {
    const now = 1_800_000_000;
    const jwt = signedEvent(privateKey, {
      iat: now - 10,
      exp: now + 300,
      data: JSON.stringify({
        instanceId: "instance-123456",
        eventType: "wix.contacts.v4.contact_created",
        data: JSON.stringify({ id: "event-123", entityId: "contact-456" }),
      }),
    });
    const event = verifyAndDecodeWixWebhook(jwt, publicKey, now);
    expect(event.instanceId).toBe("instance-123456");
    expect(event.eventType).toBe("wix.contacts.v4.contact_created");
    expect(event.eventId).toBe("event-123");
    expect(event.data).toEqual({ id: "event-123", entityId: "contact-456" });
  });

  it("rejects expired tokens and invalid signatures", () => {
    const expired = signedEvent(privateKey, {
      iat: 1_700_000_000, exp: 1_700_000_100,
      data: JSON.stringify({ instanceId: "instance-123456", eventType: "wix.contacts.v4.contact_created", data: "{}" }),
    });
    expect(() => verifyAndDecodeWixWebhook(expired, publicKey, 1_800_000_000)).toThrow(/Expired/);
    expect(() => verifyAndDecodeWixWebhook(`${expired.slice(0, -1)}x`, publicKey, 1_700_000_050)).toThrow();
  });
});
