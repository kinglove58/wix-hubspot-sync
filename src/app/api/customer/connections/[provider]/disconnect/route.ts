import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext, CustomerAccessError } from "@/lib/security/customer-auth";
import { requireOwnedAccount } from "@/lib/security/customer-resources";
import { customerFailure, readCustomerJson } from "@/lib/security/customer-response";
import { disconnectProvider } from "@/lib/providers/connections";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ provider: string }> }) {
  try {
    const access = await requireTenantContext(request, true);
    const { provider } = await context.params;
    if (provider !== "wix" && provider !== "hubspot") throw new CustomerAccessError(400, "Unsupported provider");
    const input = z.object({ externalAccountId: z.string().min(1).max(512) }).safeParse(await readCustomerJson(request));
    if (!input.success) throw new CustomerAccessError(400, "A provider account is required");
    await requireOwnedAccount(access, provider, input.data.externalAccountId);
    await disconnectProvider(provider, input.data.externalAccountId);
    return NextResponse.json({ disconnected: true });
  } catch (error) { return customerFailure(error, "customer_disconnect"); }
}
