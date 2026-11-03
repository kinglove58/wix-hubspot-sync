import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { decryptToken, encryptToken } from "@/lib/security/token-crypto";
import { ProviderApiError, ProviderPreflightError } from "@/lib/providers/api-error";

export type CreationIntent = {
  id: string;
  state: "reserved" | "creating" | "completed";
  lookupEmail: string | null;
  destinationId: string | null;
};

export class ContactReconciliationRequired extends Error {
  constructor() { super("Uncertain contact creation requires reconciliation; another create was blocked"); }
}

/** Store the initial matching email before any remote creation. Email changes on
 * later source events must not lose the identity of an uncommitted remote create. */
export async function prepareContactCreation(input: {
  wixConnectionId: string; hubspotConnectionId: string;
  sourceProvider: "wix" | "hubspot"; sourceId: string; email?: string | null;
}): Promise<CreationIntent> {
  const db = getSupabaseAdmin();
  const row = { wix_connection_id: input.wixConnectionId, hubspot_connection_id: input.hubspotConnectionId,
    source_provider: input.sourceProvider, source_contact_id: input.sourceId };
  const inserted = await db.from("contact_creation_intents").upsert({ ...row,
    encrypted_lookup_email: input.email?.trim() ? encryptToken(input.email.trim().toLowerCase()) : null,
  }, { onConflict: "wix_connection_id,hubspot_connection_id,source_provider,source_contact_id", ignoreDuplicates: true });
  if (inserted.error) throw new Error("Unable to reserve contact creation");
  const { data, error } = await db.from("contact_creation_intents")
    .select("id,state,encrypted_lookup_email,destination_contact_id")
    .eq("wix_connection_id", input.wixConnectionId).eq("hubspot_connection_id", input.hubspotConnectionId)
    .eq("source_provider", input.sourceProvider).eq("source_contact_id", input.sourceId).single();
  if (error || !data) throw new Error("Unable to read contact creation intent");
  return { id: data.id as string, state: data.state as CreationIntent["state"],
    lookupEmail: data.encrypted_lookup_email ? decryptToken(data.encrypted_lookup_email as string) : null,
    destinationId: data.destination_contact_id as string | null };
}

export async function rememberContactCreation(intent: CreationIntent, destinationId: string): Promise<void> {
  const { error } = await getSupabaseAdmin().rpc("remember_contact_creation", { p_intent_id: intent.id, p_destination_id: destinationId });
  if (error) throw new Error("Unable to remember created contact identity");
}

/** Only one attempt may cross the remote-create boundary. A network/5xx/DB
 * failure leaves state=creating; retries search the original email or remembered
 * ID and never create again while the outcome is uncertain. */
export async function createContactWithIntent<T extends { id?: string }>(intent: CreationIntent, create: () => Promise<T>): Promise<T> {
  if (intent.state !== "reserved") throw new ContactReconciliationRequired();
  const attemptId = randomUUID();
  const db = getSupabaseAdmin();
  const { data, error } = await db.from("contact_creation_intents").update({
    state: "creating", attempt_id: attemptId, updated_at: new Date().toISOString(),
  }).eq("id", intent.id).eq("state", "reserved").select("id").maybeSingle();
  if (error) throw new Error("Unable to claim contact creation intent");
  if (!data) throw new ContactReconciliationRequired();
  let result: T;
  try {
    result = await create();
  } catch (error) {
    // These responses reject the write before application. 409, timeouts and
    // server errors remain uncertain and must be reconciled instead of repeated.
    if (error instanceof ProviderPreflightError || error instanceof ProviderApiError && [400, 401, 403, 404, 422, 429].includes(error.status)) {
      const reset = await db.from("contact_creation_intents").update({ state: "reserved", attempt_id: null,
        updated_at: new Date().toISOString() }).eq("id", intent.id).eq("attempt_id", attemptId).eq("state", "creating");
      if (reset.error) throw new Error("Unable to reset rejected contact creation");
    }
    throw error instanceof ProviderPreflightError ? error.cause : error;
  }
  if (!result.id) throw new ContactReconciliationRequired();
  await rememberContactCreation(intent, result.id);
  return result;
}
