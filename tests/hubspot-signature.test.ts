import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHubSpotSignature } from "../src/lib/webhooks/hubspot-signature";

describe("HubSpot v3 webhook signature", () => {
  it("verifies the raw body and HubSpot-normalized request URI", () => {
    const now = 1_800_000_000_000;
    const timestamp = String(now);
    const secret = "test-client-secret";
    const url = "https://sync.example.com/api/webhooks/a%3Ab?next=a%2Fb#not-signed";
    const normalizedUrl = "https://sync.example.com/api/webhooks/a:b?next=a/b";
    const body = '[{"eventId":123,"subscriptionType":"contact.creation"}]';
    const source = "POST" + normalizedUrl + body + timestamp;
    const signature = createHmac("sha256", secret).update(source, "utf8").digest("base64");

    expect(verifyHubSpotSignature({
      clientSecret: secret, method: "POST", requestUrl: url,
      rawBody: body, signature, timestamp, now,
    })).toBe(true);
  });

  it("rejects stale timestamps and tampered payloads", () => {
    const now = 1_800_000_000_000;
    const timestamp = String(now);
    const secret = "test-client-secret";
    const url = "https://sync.example.com/api/webhooks/hubspot";
    const body = "original";
    const signature = createHmac("sha256", secret).update("POST" + url + body + timestamp).digest("base64");

    expect(verifyHubSpotSignature({
      clientSecret: secret, method: "POST", requestUrl: url,
      rawBody: body, signature, timestamp, now: now + 6 * 60 * 1000,
    })).toBe(false);
    expect(verifyHubSpotSignature({
      clientSecret: secret, method: "POST", requestUrl: url,
      rawBody: "tampered", signature, timestamp, now,
    })).toBe(false);
  });
});
