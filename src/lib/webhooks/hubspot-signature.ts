import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

const HUBSPOT_URL_ESCAPES: Record<string, string> = {
  "%3A": ":", "%2F": "/", "%3F": "?", "%40": "@",
  "%21": "!", "%24": "$", "%27": "'", "%28": "(",
  "%29": ")", "%2A": "*", "%2C": ",", "%3B": ";",
};

function normalizeRequestUri(requestUrl: string): string | null {
  try {
    // Fragments are not part of an HTTP request target and must not be signed.
    const withoutFragment = requestUrl.split("#", 1)[0];
    new URL(withoutFragment);
    return withoutFragment.replace(/%(3A|2F|3F|40|21|24|27|28|29|2A|2C|3B)/gi,
      (encoded) => HUBSPOT_URL_ESCAPES[encoded.toUpperCase()] ?? encoded);
  } catch {
    return null;
  }
}

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

  const canonicalUrl = normalizeRequestUri(input.requestUrl);
  if (!canonicalUrl) return false;

  const source = input.method.toUpperCase() + canonicalUrl + input.rawBody + input.timestamp;
  const expected = createHmac("sha256", input.clientSecret).update(source, "utf8").digest("base64");
  const actualBuffer = Buffer.from(input.signature);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer);
}
