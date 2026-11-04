import { NextRequest, NextResponse } from "next/server";
import { requireTenantContext, CustomerAccessError } from "@/lib/security/customer-auth";
import { requireOwnedAccount, requireOwnedPair } from "@/lib/security/customer-resources";
import { customerFailure, readCustomerJson } from "@/lib/security/customer-response";
import { mappingConfigurationSchema, storedMappingErrors } from "@/lib/sync/mapping-input";
import { resolveProviderConnections } from "@/lib/sync/connection-repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  try {
    const context = await requireTenantContext(request, true);
    const parsed = mappingConfigurationSchema.safeParse(await readCustomerJson(request));
    if (!parsed.success || storedMappingErrors(parsed.data.mappings).length) throw new CustomerAccessError(400, "Invalid field mapping configuration");
    const input = parsed.data;
    const wix = await requireOwnedAccount(context, "wix", input.instanceId);
    const ownedPair = await requireOwnedPair(context, wix.id, input.pairId);
    const pair = await resolveProviderConnections(input.instanceId, ownedPair.id);
    const result = await getSupabaseAdmin().rpc("replace_field_mappings", { p_wix_id: pair.wix.id, p_hubspot_id: pair.hubspot.id, p_mappings: input.mappings });
    if (result.error) throw new Error("Mapping storage unavailable");
    return NextResponse.json({ saved: true, count: input.mappings.length });
  } catch (error) { return customerFailure(error, "customer_save_mappings"); }
}
