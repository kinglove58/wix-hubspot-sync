import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/** Verify HubSpot's v3 request signature before parsing or persisting the body. */
export function verifyHubSpotSignature(input: {
  clientSecret: string;
  method: string;
  requestUrl: string;
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  now?: number;
}): boolean {
  if (!input.signature || !input.timestamp || !input.clientSecret) return false;
  const timestamp = Number(input.timestamp);
  const now = input.now ?? Date.now();
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 5 * 60 * 1000) return false;

  let canonicalUrl: string;
  try {
    const url = new URL(input.requestUrl);
    canonicalUrl = url.toString();
  } catch {
    return false;
  }

  const source = input.method.toUpperCase() + canonicalUrl + input.rawBody + input.timestamp;
  const expected = createHmac("sha256", input.clientSecret).update(source, "utf8").digest("base64");
  const actualBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}
