import "server-only";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export class IntegrationBusyError extends Error {
  constructor() { super("Integration is busy; retry later"); }
}
export class IntegrationLeaseLostError extends Error {
  constructor() { super("Integration lease expired or was replaced; write blocked"); }
}
const work = new AsyncLocalStorage<{ deadline: number; leases: Array<{ key: string; owner: string }> }>();

/** Share one budget across all targets and events in a worker request. */
export function withIntegrationWorkBudget<T>(run: () => Promise<T>): Promise<T> {
  const parent = work.getStore();
  return work.run({ deadline: Math.min(parent?.deadline ?? Infinity, Date.now() + 240_000), leases: parent?.leases ?? [] }, run);
}

export function integrationWorkSignal(): AbortSignal {
  const deadline = work.getStore()?.deadline;
  if (deadline && Date.now() >= deadline) throw new IntegrationLeaseLostError();
  return AbortSignal.timeout(deadline ? Math.max(1, deadline - Date.now()) : 240_000);
}

/** Check ownership immediately before provider mutations, including after a
 * suspended worker resumes. Providers without conditional updates still require
 * live acceptance for a user edit racing the final HTTP write. */
export async function assertIntegrationLease(): Promise<void> {
  const context = work.getStore();
  if (!context) return;
  if (Date.now() >= context.deadline) throw new IntegrationLeaseLostError();
  for (const lease of context.leases) {
    const { data, error } = await getSupabaseAdmin().from("integration_leases").select("owner")
      .eq("lease_key", lease.key).eq("owner", lease.owner).gt("expires_at", new Date().toISOString()).maybeSingle();
    if (error || !data) throw new IntegrationLeaseLostError();
  }
}

/** Serialize writes per installation across manual jobs, webhooks and forms. */
export async function withIntegrationLease<T>(key: string, run: () => Promise<T>): Promise<T> {
  const db = getSupabaseAdmin();
  const owner = randomUUID();
  const { data, error } = await db.rpc("acquire_integration_lease", { p_key: key, p_owner: owner });
  if (error) throw new Error("Unable to acquire integration lease");
  if (data !== true) throw new IntegrationBusyError();
  try {
    const parent = work.getStore();
    return await work.run({ deadline: Math.min(parent?.deadline ?? Infinity, Date.now() + 240_000),
      leases: [...(parent?.leases ?? []), { key, owner }] }, run);
  } finally {
    const { error: releaseError } = await db.from("integration_leases").delete().eq("lease_key", key).eq("owner", owner);
    if (releaseError) throw new Error("Unable to release integration lease");
  }
}
