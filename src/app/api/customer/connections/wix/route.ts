import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext, CustomerAccessError } from "@/lib/security/customer-auth";
import { customerFailure, readCustomerJson } from "@/lib/security/customer-response";
import { verifyWixCustomerProof } from "@/lib/providers/wix/customer-proof";
import { requestWixInstanceToken } from "@/lib/providers/wix/client";
import { saveCustomerConnection } from "@/lib/providers/customer-connections";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const context = await requireTenantContext(request, true);
    const parsed = z.object({ instance: z.string().min(1).max(16_384) }).safeParse(await readCustomerJson(request));
    if (!parsed.success) throw new CustomerAccessError(400, "A signed Wix application context is required");
    const proof = await verifyWixCustomerProof(parsed.data.instance);
    const token = await requestWixInstanceToken(proof.instanceId);
    const connection = await saveCustomerConnection(context, { provider: "wix", accountId: proof.instanceId, label: "Wix site", accessToken: token.access_token, expiresIn: token.expires_in });
    return NextResponse.json({ connected: true, connection });
  } catch (error) { return customerFailure(error, "customer_connect_wix"); }
}
