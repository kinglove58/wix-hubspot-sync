import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerEnv } from "@/lib/env";
import { requestWixInstanceToken } from "@/lib/providers/wix/client";
import { saveProviderConnection } from "@/lib/providers/connections";
import { isAuthorizedAdmin } from "@/lib/security/admin-auth";

export const runtime = "nodejs";

const bodySchema = z.object({ instanceId: z.string().min(8).max(512) });

export async function POST(request: NextRequest) {
  if (!isAuthorizedAdmin(request)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const env = getServerEnv();
  if (!env.WIX_APP_ID || !env.WIX_APP_SECRET) return NextResponse.json({ error: "Wix app credentials are not configured" }, { status: 503 });

  try {
    const body = bodySchema.parse(await request.json());
    const token = await requestWixInstanceToken(body.instanceId);
    const connection = await saveProviderConnection({
      provider: "wix", externalAccountId: body.instanceId, accountLabel: "Wix site",
      accessToken: token.access_token, expiresIn: token.expires_in,
    });
    return NextResponse.json({ connected: true, connection });
  } catch (error) {
    const message = error instanceof z.ZodError ? "Invalid Wix instance ID" : "Unable to connect Wix instance";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
