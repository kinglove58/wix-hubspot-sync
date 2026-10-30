import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { generateKeyPairSync, sign } from "node:crypto";

let privateKey: string;
let publicKey: string;

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeToken(payload: Record<string, unknown>): string {
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const body = b64url(payload);
  const signingInput = header + "." + body;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return signingInput + "." + signature;
}

describe("verifyWixWebhook", () => {
  beforeAll(() => {
    const pair = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    privateKey = pair.privateKey;
    publicKey = pair.publicKey;
  });

  it("verifies the RS256 signature and unwraps the nested Wix envelope", async () => {
    const { verifyWixWebhook } = await import("../src/lib/webhooks/wix-signature");
    const token = makeToken({
      exp: 2_000_000_000,
      iat: 1_999_999_000,
      data: JSON.stringify({
        eventType: "wix.contacts.v4.contact_created",
        instanceId: "instance-123",
        data: JSON.stringify({ id: "event-1", entityId: "contact-1" }),
      }),
    });
    const event = verifyWixWebhook({ token, publicKey, now: 1_999_999_500_000 });
    expect(event).toMatchObject({
      eventType: "wix.contacts.v4.contact_created",
      instanceId: "instance-123",
      eventId: "event-1",
      entityId: "contact-1",
    });
  });

  it("rejects expired tokens and altered signatures", async () => {
    const { verifyWixWebhook } = await import("../src/lib/webhooks/wix-signature");
    const expired = makeToken({
      exp: 1_000,
      iat: 900,
      data: JSON.stringify({ eventType: "x", instanceId: "i", data: "{}" }),
    });
    expect(verifyWixWebhook({ token: expired, publicKey, now: 2_000_000 })).toBeNull();

    const valid = makeToken({
      exp: 2_000_000_000,
      iat: 1_999_999_000,
      data: JSON.stringify({ eventType: "x", instanceId: "i", data: "{}" }),
    });
    const parts = valid.split(".");
    parts[2] = Buffer.from("tampered").toString("base64url");
    expect(verifyWixWebhook({ token: parts.join("."), publicKey, now: 1_999_999_500_000 })).toBeNull();
  });
});
