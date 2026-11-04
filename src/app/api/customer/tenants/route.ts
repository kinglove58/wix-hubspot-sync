import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCustomerUser, CustomerAccessError } from "@/lib/security/customer-auth";
import { customerFailure, readCustomerJson } from "@/lib/security/customer-response";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const userId = await requireCustomerUser(request);
    const db = getSupabaseAdmin();
    const membership = await db.from("tenant_memberships").select("tenant_id,role").eq("user_id", userId);
    if (membership.error) throw new Error("Membership storage unavailable");
    const rows = membership.data ?? [];
    if (!rows.length) return NextResponse.json({ tenants: [] });
    const tenants = await db.from("tenants").select("id,name").in("id", rows.map((row) => row.tenant_id)).is("disabled_at", null);
    if (tenants.error) throw new Error("Tenant storage unavailable");
    return NextResponse.json({ tenants: (tenants.data ?? []).map((tenant) => ({ ...tenant, role: rows.find((row) => row.tenant_id === tenant.id)!.role })) });
  } catch (error) { return customerFailure(error, "list_customer_tenants"); }
}

export async function POST(request: NextRequest) {
  try {
    const userId = await requireCustomerUser(request);
    const parsed = z.object({ name: z.string().trim().min(1).max(120) }).safeParse(await readCustomerJson(request));
    if (!parsed.success) throw new CustomerAccessError(400, "A tenant name of 1–120 characters is required");
    const created = await getSupabaseAdmin().rpc("create_customer_tenant", { p_user_id: userId, p_name: parsed.data.name });
    if (created.error || typeof created.data !== "string") throw new Error("Tenant storage unavailable");
    return NextResponse.json({ id: created.data }, { status: 201 });
  } catch (error) { return customerFailure(error, "create_customer_tenant"); }
}
