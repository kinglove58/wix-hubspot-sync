import "server-only";
import { z } from "zod";
import { CustomerAccessError } from "@/lib/security/customer-auth";
import { ProviderApiError } from "@/lib/providers/api-error";

/** Wix recommends Token Info validation for signed external-dashboard context.
 * Parsing local claims never authorizes a request without provider verification. */
export async function verifyWixCustomerProof(proof: string, now = Date.now()): Promise<{ instanceId: string }> {
  const appId = process.env.WIX_APP_ID?.trim();
  if (!appId) throw new CustomerAccessError(503, "Wix authentication is not configured");
  const parts = proof.split(".");
  const invalid = () => new CustomerAccessError(403, "Open the app again from Wix as the site owner before connecting");
  if (proof.length > 16_384 || parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part) || Buffer.from(part, "base64url").toString("base64url") !== part)) throw invalid();
  if (Buffer.from(parts[0], "base64url").length !== 32) throw invalid();
  let decoded: unknown;
  try { decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); }
  catch { throw invalid(); }
  const claims = z.object({ instanceId: z.uuid(), uid: z.uuid(), siteOwnerId: z.uuid(), permissions: z.literal("OWNER"), signDate: z.string(), aid: z.string().optional(), appDefId: z.string().optional() }).safeParse(decoded);
  if (!claims.success || claims.data.uid !== claims.data.siteOwnerId || claims.data.aid || claims.data.appDefId && claims.data.appDefId !== appId) throw invalid();
  const signedAt = Date.parse(claims.data.signDate);
  if (!Number.isFinite(signedAt) || signedAt > now + 60_000 || now - signedAt > 600_000) throw invalid();
  const response = await fetch("https://www.wixapis.com/oauth2/token-info", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: proof }),
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    if ([400,401,403].includes(response.status)) throw invalid();
    throw new ProviderApiError("wix", response.status, response.headers.get("retry-after"));
  }
  const epoch = z.union([z.number().int().nonnegative().max(999_999_999_999), z.string().regex(/^\d{1,12}$/)]).transform(Number);
  const info = z.object({ active: z.union([z.boolean(), z.enum(["true", "false"])]), clientId: z.string(), instanceId: z.string(),
    exp: epoch.optional(), iat: epoch.optional(),
  }).safeParse(await response.json());
  if (!info.success || ![true, "true"].includes(info.data.active) || info.data.clientId !== appId || info.data.instanceId !== claims.data.instanceId ||
      info.data.exp !== undefined && Number(info.data.exp) * 1000 <= now || info.data.iat !== undefined && Number(info.data.iat) * 1000 > now + 60_000) throw invalid();
  return { instanceId: claims.data.instanceId };
}
