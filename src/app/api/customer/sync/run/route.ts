import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireTenantContext, CustomerAccessError } from "@/lib/security/customer-auth";
import { requireOwnedAccount, requireOwnedPair } from "@/lib/security/customer-resources";
import { customerFailure, readCustomerJson } from "@/lib/security/customer-response";
import { resolveProviderConnections } from "@/lib/sync/connection-repository";
import { listEnabledMappings } from "@/lib/sync/mapping-repository";
import { syncWixContactToHubSpot, syncHubSpotContactToWix } from "@/lib/sync/engine";
import { getHubSpotContact } from "@/lib/providers/hubspot/client";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const context = await requireTenantContext(request, true);
    const parsed = z.object({ provider: z.enum(["wix", "hubspot"]), instanceId: z.string().min(1).max(512), pairId: z.uuid().optional(), contactId: z.string().min(1).max(512) }).safeParse(await readCustomerJson(request));
    if (!parsed.success) throw new CustomerAccessError(400, "Valid provider, instance and contact identifiers are required");
    const input = parsed.data;
    const wix = await requireOwnedAccount(context, "wix", input.instanceId);
    const ownedPair = await requireOwnedPair(context, wix.id, input.pairId);
    if (input.provider === "wix") return NextResponse.json(await syncWixContactToHubSpot(input.instanceId, input.contactId, ownedPair.id));
    const pair = await resolveProviderConnections(input.instanceId, ownedPair.id);
    const mappings = await listEnabledMappings(pair.wix.id, pair.hubspot.id);
    const contact = await getHubSpotContact(input.contactId, mappings.filter((mapping) => mapping.enabled).map((mapping) => mapping.targetField), pair.hubspot.id);
    return NextResponse.json(await syncHubSpotContactToWix(input.instanceId, input.contactId, contact, ownedPair.id));
  } catch (error) { return customerFailure(error, "customer_manual_sync"); }
}
