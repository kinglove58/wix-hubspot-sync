import "server-only";
import { z } from "zod";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export class CustomerAccessError extends Error {
  constructor(readonly status: 400 | 401 | 403 | 409 | 503, message: string) { super(message); }
}
export type TenantContext = { userId: string; tenantId: string; role: "owner" | "admin" | "viewer" };
const uuid = z.uuid();

/** Use the Auth server's verified user, never browser-supplied identity or getSession. */
export async function requireCustomerUser(request: Request): Promise<string> {
  if (process.env.CUSTOMER_ACCESS_ENABLED !== "true") throw new CustomerAccessError(503, "Customer access is not enabled");
  const header = request.headers.get("authorization") ?? "";
  if (header.length > 16_384 || !/^Bearer [A-Za-z0-9._-]+$/i.test(header)) throw new CustomerAccessError(401, "Sign in required");
  const { data, error } = await getSupabaseAdmin().auth.getUser(header.slice(7));
  if (error || !data.user || !uuid.safeParse(data.user.id).success || data.user.is_anonymous || !data.user.email_confirmed_at) {
    throw new CustomerAccessError(401, "A verified customer account is required");
  }
  return data.user.id;
}

/** Membership is rechecked on each request so revoked access is not cached in JWT claims. */
export async function requireTenantContext(request: Request, write = false): Promise<TenantContext> {
  const userId = await requireCustomerUser(request);
  const selected = uuid.safeParse(request.headers.get("x-tenant-id"));
  if (!selected.success) throw new CustomerAccessError(400, "A valid tenant selection is required");
  return tenantContextForVerifiedUser(userId, selected.data, write);
}

/** Internal callbacks may use this only after independently verifying the user
 * through Supabase Auth; never pass browser user IDs to it. */
export async function tenantContextForVerifiedUser(userId: string, tenantId: string, write = false): Promise<TenantContext> {
  const db = getSupabaseAdmin();
  const membership = await db.from("tenant_memberships").select("role")
    .eq("tenant_id", tenantId).eq("user_id", userId).maybeSingle();
  if (membership.error) throw new CustomerAccessError(503, "Unable to verify tenant access");
  const role = z.enum(["owner", "admin", "viewer"]).safeParse(membership.data?.role);
  if (!role.success || write && role.data === "viewer") throw new CustomerAccessError(403, "Tenant access denied");
  const tenant = await db.from("tenants").select("id").eq("id", tenantId).is("disabled_at", null).maybeSingle();
  if (tenant.error) throw new CustomerAccessError(503, "Unable to verify tenant access");
  if (!tenant.data) throw new CustomerAccessError(403, "Tenant access denied");
  return { userId, tenantId, role: role.data };
}

export async function requireOwnedConnection(context: TenantContext, id: string, provider?: "wix" | "hubspot") {
  if (!uuid.safeParse(id).success) throw new CustomerAccessError(400, "A valid connection is required");
  let query = getSupabaseAdmin().from("provider_connections").select("id,provider,external_account_id,disconnected_at")
    .eq("id", id).eq("tenant_id", context.tenantId);
  if (provider) query = query.eq("provider", provider);
  const result = await query.maybeSingle();
  if (result.error) throw new CustomerAccessError(503, "Unable to verify connection access");
  if (!result.data) throw new CustomerAccessError(403, "Connection access denied");
  return result.data as { id: string; provider: "wix" | "hubspot"; external_account_id: string; disconnected_at: string | null };
}
