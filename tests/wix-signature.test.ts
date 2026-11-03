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

  it("rejects malformed JWTs, unsupported algorithms and invalid keys", () => {
    const jwt = signedEvent(privateKey, { exp: 1800000300, data: {} });
    for (const value of ["invalid", "a.b.c", "!.b.c", jwt.replace(jwt.split(".")[0], Buffer.from('{"alg":"HS256"}').toString("base64url"))]) {
      expect(() => verifyAndDecodeWixWebhook(value, publicKey, 1800000000)).toThrow();
    }
    expect(() => verifyAndDecodeWixWebhook(jwt, "", 1800000000)).toThrow();
    expect(() => verifyAndDecodeWixWebhook(jwt, "invalid-key", 1800000000)).toThrow();
  });

  it("validates nested envelopes and supports event IDs on the outer event", () => {
    const now = 1800000000;
    for (const data of [undefined, null, [], "null", "{", {}, { instanceId: "site" }, { instanceId: "site", eventType: "AppInstalled", data: "[]" }]) {
      expect(() => verifyAndDecodeWixWebhook(signedEvent(privateKey, { exp: now + 300, data }), publicKey, now)).toThrow();
    }
    const event = verifyAndDecodeWixWebhook(signedEvent(privateKey, { exp: now + 300, data: { instanceId: "site", eventType: "AppInstalled", eventId: "outer", data: {} } }), publicKey, now);
    expect(event.eventId).toBe("outer");
    expect(event.issuedAt).toBeUndefined();
    expect(verifyAndDecodeWixWebhook(signedEvent(privateKey, { exp: now + 300, data: { instanceId: "site", eventType: "AppInstalled" } }), publicKey, now).eventId).toBeUndefined();
  });

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
    const parts = expired.split(".");
    const signature = Buffer.from(parts[2], "base64url");
    signature[0] ^= 1;
    parts[2] = signature.toString("base64url");
    expect(() => verifyAndDecodeWixWebhook(parts.join("."), publicKey, 1_700_000_050)).toThrow();
  });

  it.each(["tomorrow", null, {}, []])("rejects a nonnumeric expiry claim: %j", (exp) => {
    const jwt = signedEvent(privateKey, { exp, data: { instanceId: "site", eventType: "AppInstalled", data: "{}" } });
    expect(() => verifyAndDecodeWixWebhook(jwt, publicKey)).toThrow();
  });

  it("rejects invalid issued-at claims", () => {
    const now = 1_800_000_000;
    for (const iat of ["now", now + 120, now + 400]) {
      const jwt = signedEvent(privateKey, { iat, exp: now + 300, data: { instanceId: "site", eventType: "AppInstalled", data: "{}" } });
      expect(() => verifyAndDecodeWixWebhook(jwt, publicKey, now)).toThrow();
    }
  });
});
