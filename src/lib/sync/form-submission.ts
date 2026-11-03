import "server-only";

import {
  createHubSpotContact,
  ensureHubSpotFormAttributionProperties,
  findHubSpotContactByEmail,
  updateHubSpotContact,
  getHubSpotContact,
} from "@/lib/providers/hubspot/client";
import { resolveProviderConnections } from "@/lib/sync/connection-repository";
import { getWixContact } from "@/lib/providers/wix/contacts";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { withIntegrationLease } from "@/lib/sync/lease";
import { prepareContactCreation, rememberContactCreation, createContactWithIntent } from "@/lib/sync/creation-intent";
import { listEnabledMappings } from "@/lib/sync/mapping-repository";
import { resolveConflict } from "@/lib/sync/conflict";
import { syncAuditContext } from "@/lib/sync/audit-context";
import { hubSpotContactToWixInfo } from "@/lib/sync/normalize";
import { mergedWixProperties } from "@/lib/sync/contact-mapping";
import { ProviderApiError } from "@/lib/providers/api-error";
import { rootFailure } from "@/lib/webhooks/retry-policy";
import { logOperationFailure } from "@/lib/security/log";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function flattenFields(data: UnknownRecord): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const raw = data.submissions ?? data.fields ?? data.answers ?? data.formFields ?? data.submissionData;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      const field = record(item);
      const name = [field.fieldName, field.name, field.label, field.key, field.id]
        .find((value) => typeof value === "string");
      if (typeof name === "string") {
        output[normalizeKey(name)] = field.value ?? field.fieldValue ?? field.answer;
      }
    }
  } else {
    for (const [key, value] of Object.entries(record(raw))) output[normalizeKey(key)] = value;
  }
  return output;
}

function pick(fields: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = fields[normalizeKey(key)];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function textAt(objects: UnknownRecord[], keys: string[]): string | undefined {
  for (const object of objects) {
    for (const key of keys) {
      const value = object[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
  }
  return undefined;
}

/** Convert a Wix Forms event into a deduplicated HubSpot contact with attribution. */
export async function syncWixFormSubmissionToHubSpot(instanceId: string, eventData: UnknownRecord, pairId?: string) {
  return withIntegrationLease(`sync:${instanceId}`, async () => {
    const pair = await resolveProviderConnections(instanceId, pairId);
    return withIntegrationLease(`portal:${pair.hubspot.id}`, async () => {
      try { return await syncSubmission(instanceId, eventData, pairId); }
      catch (error) {
        const cause = rootFailure(error);
        const code = cause instanceof ProviderApiError ? `${cause.provider.toUpperCase()}_HTTP_${cause.status}` : "FORM_SYNC_FAILED";
        try {
          const audit = await getSupabaseAdmin().from("sync_audit_logs").insert({
            provider: "wix", wix_connection_id: pair.wix.id, hubspot_connection_id: pair.hubspot.id,
            action: "wix_form_submission_to_hubspot", outcome: "failed", safe_details: { ...syncAuditContext(), code },
          });
          if (audit.error) throw new Error("Form failure audit unavailable");
        } catch {
          logOperationFailure("SYNC_AUDIT_WRITE_FAILED", { ...syncAuditContext(), provider: "wix", operation: "audit_form_sync", result: "failed" });
        }
        throw error;
      }
    });
  });
}

async function syncSubmission(instanceId: string, eventData: UnknownRecord, pairId?: string) {
  const connections = await resolveProviderConnections(instanceId, pairId);
  const auditSkipped = async (reason: string) => {
    const { error } = await getSupabaseAdmin().from("sync_audit_logs").insert({
      provider: "wix", action: "form_submission", outcome: "skipped",
      wix_connection_id: connections.wix.id, hubspot_connection_id: connections.hubspot.id,
      safe_details: { ...syncAuditContext(), reason },
    });
    if (error) throw new Error("Unable to record skipped form submission");
    return { status: "skipped" as const, reason };
  };
  const mappings = await listEnabledMappings(connections.wix.id, connections.hubspot.id);
  const enabled = mappings.length ? mappings.some((mapping) => mapping.enabled && ["both", "wix_to_hubspot"].includes(mapping.direction)) : connections.useDefaultMappings !== false;
  if (!enabled) return auditSkipped("no_enabled_mapping_for_direction");
  const submission = record(record(eventData.createdEvent).entity ?? eventData.submission ?? eventData.formSubmission);
  const context = record(eventData.submissionContext ?? eventData.context ?? submission.context);
  const fields = { ...flattenFields(eventData), ...flattenFields(submission) };

  const email = pick(fields, ["email", "emailAddress", "e-mail"]);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return auditSkipped("valid_email_required");
  }

  const contactProperties: Record<string, string> = { email };
  const firstName = pick(fields, ["firstName", "first_name", "givenName"]);
  const lastName = pick(fields, ["lastName", "last_name", "surname", "familyName"]);
  const phone = pick(fields, ["phone", "phoneNumber", "mobile"]);
  const company = pick(fields, ["company", "companyName", "organization"]);
  if (firstName) contactProperties.firstname = firstName;
  if (lastName) contactProperties.lastname = lastName;
  if (phone) contactProperties.phone = phone;
  if (company) contactProperties.company = company;
  // Contact fields in a form obey the same custom/default masks as contact events.
  // Attribution and dedicated wix_form_* fields remain form-specific below.
  const properties = mergedWixProperties({ info: hubSpotContactToWixInfo({ properties: contactProperties }) }, mappings, connections.useDefaultMappings);

  const standardFields = new Set([
    "email", "emailaddress", "e-mail", "firstname", "first_name", "givenname",
    "lastname", "last_name", "surname", "familyname", "phone", "phonenumber",
    "mobile", "company", "companyname", "organization",
  ].map(normalizeKey));
  const customPropertyDefinitions: Array<{ name: string; label: string }> = [];
  for (const [fieldKey, value] of Object.entries(fields)) {
    if (standardFields.has(fieldKey) || value == null ||
        !["string", "number", "boolean"].includes(typeof value)) continue;
    const textValue = String(value).trim();
    if (!textValue) continue;
    const propertyName = `wix_form_${fieldKey.slice(0, 60)}`;
    properties[propertyName] = textValue;
    customPropertyDefinitions.push({
      name: propertyName,
      label: `Wix Form ${fieldKey.slice(0, 40)}`,
    });
  }

  const utm = record(eventData.utm ?? submission.utm ?? context.utm ?? eventData.utmParameters ?? context.utmParameters);
  const pageContext = record(eventData.page ?? context.page);
  const sourceObjects = [eventData, submission, context, utm, pageContext];
  // Use the immutable submission creation time, never delivery/processing time.
  // A delayed webhook must not acquire a newer version just because it was retried.
  const suppliedTime = textAt([submission, eventData], ["createdDate", "submittedAt", "submissionTime"]);
  const submittedAt = suppliedTime && Number.isFinite(Date.parse(suppliedTime)) ? new Date(suppliedTime).toISOString() : undefined;
  const attribution: Record<string, string | undefined> = {
    utm_source: textAt(sourceObjects, ["utm_source", "utmSource"]),
    utm_medium: textAt(sourceObjects, ["utm_medium", "utmMedium"]),
    utm_campaign: textAt(sourceObjects, ["utm_campaign", "utmCampaign"]),
    utm_term: textAt(sourceObjects, ["utm_term", "utmTerm"]),
    utm_content: textAt(sourceObjects, ["utm_content", "utmContent"]),
    landing_page_url: textAt(sourceObjects, ["pageUrl", "pageURL", "landingPageUrl", "url"]),
    lead_referrer: textAt(sourceObjects, ["referrer", "referer", "referrerUrl"]),
    form_submitted_at: submittedAt,
  };
  if (attribution.landing_page_url) {
    try {
      const page = new URL(attribution.landing_page_url);
      for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const) {
        attribution[key] ??= page.searchParams.get(key) ?? undefined;
      }
    } catch {
      // Keep the supplied page URL as-is; malformed URLs are not used for UTM extraction.
    }
  }
  for (const [key, value] of Object.entries(attribution)) if (value) properties[key] = value;

  if (customPropertyDefinitions.length > 25) throw new Error("Form exceeds the configured custom property limit");
  const wixContactId = textAt([eventData, submission], ["contactId", "wixContactId"]);
  const wixContact = wixContactId ? await getWixContact(instanceId, wixContactId) : null;
  const sourceLink = wixContactId ? await getSupabaseAdmin().from("contact_links").select("hubspot_contact_id")
    .eq("wix_connection_id", connections.wix.id).eq("hubspot_connection_id", connections.hubspot.id)
    .eq("wix_contact_id", wixContactId).maybeSingle() : null;
  if (sourceLink?.error) throw new Error("Unable to inspect form contact identity");
  const submissionId = textAt([eventData, submission], ["entityId", "id"]);
  if (!wixContactId && !submissionId) throw new Error("A stable form submission identity is required");
  const intent = sourceLink?.data?.hubspot_contact_id ? null : await prepareContactCreation({
    wixConnectionId: connections.wix.id, hubspotConnectionId: connections.hubspot.id,
    sourceProvider: "wix", sourceId: wixContactId ?? `form:${submissionId}`, email,
  });
  const existing = sourceLink?.data?.hubspot_contact_id
    ? { id: sourceLink.data.hubspot_contact_id as string }
    : intent?.destinationId ? await getHubSpotContact(intent.destinationId, [], connections.hubspot.id)
    : await findHubSpotContactByEmail(intent?.lookupEmail ?? email, connections.hubspot.id);
  if (existing?.id && wixContactId) {
    const identity = await getSupabaseAdmin().from("contact_links").select("wix_contact_id")
      .eq("wix_connection_id", connections.wix.id)
      .eq("hubspot_connection_id", connections.hubspot.id).eq("hubspot_contact_id", existing.id).maybeSingle();
    if (identity.error) throw new Error("Unable to inspect form destination identity");
    if (identity.data && identity.data.wix_contact_id !== wixContactId) throw new Error("Form destination is linked to another Wix contact");
  }
  if (existing?.id && intent) await rememberContactCreation(intent, existing.id);
  const target = existing?.id ? await getHubSpotContact(existing.id, [], connections.hubspot.id) : null;
  if (target) {
    const decision = resolveConflict(
      { provider: "wix", externalId: submissionId ?? wixContactId!, updatedAt: submittedAt ?? null },
      { provider: "hubspot", externalId: existing!.id!, updatedAt: target.updatedAt ?? null },
    );
    if (decision.winner !== "wix") return auditSkipped("hubspot_version_is_newer_or_submission_time_unavailable");
  }
  await ensureHubSpotFormAttributionProperties(customPropertyDefinitions, connections.hubspot.id);
  const saved = existing?.id
    ? await updateHubSpotContact(existing.id, properties, connections.hubspot.id, target?.updatedAt)
    : await createContactWithIntent(intent!, () => createHubSpotContact(properties, connections.hubspot.id));
  if (!saved.id) throw new Error("HubSpot did not return a contact ID");

  if (wixContactId && wixContact) {
    const { data: existingLink, error: linkReadError } = await getSupabaseAdmin()
      .from("contact_links").select("hubspot_contact_id")
      .eq("hubspot_connection_id", connections.hubspot.id)
      .eq("wix_connection_id", connections.wix.id)
      .eq("wix_contact_id", wixContactId).maybeSingle();
    if (linkReadError) throw new Error("Unable to inspect form contact link");
    if (existingLink && existingLink.hubspot_contact_id !== saved.id) throw new Error("Form contact link changed before completion");
    const { error: linkWriteError } = await getSupabaseAdmin().from("contact_links").upsert({
      wix_connection_id: connections.wix.id,
      hubspot_connection_id: connections.hubspot.id,
      wix_contact_id: wixContactId,
      hubspot_contact_id: saved.id,
      last_synced_at: new Date().toISOString(),
      last_source: "wix",
      wix_updated_at: wixContact.updatedDate ?? null,
      hubspot_updated_at: saved.updatedAt ?? null,
    }, { onConflict: "wix_connection_id,hubspot_connection_id,wix_contact_id" });
    if (linkWriteError) throw new Error("Unable to save form contact link");
  }

  const { error } = await getSupabaseAdmin().from("sync_audit_logs").insert({
    provider: "wix",
    wix_connection_id: connections.wix.id, hubspot_connection_id: connections.hubspot.id,
    action: "wix_form_submission_to_hubspot",
    outcome: "succeeded",
    hubspot_contact_id: saved.id,
    safe_details: {
      ...syncAuditContext(),
      source: "wix_form",
      has_utm: Boolean(attribution.utm_source || attribution.utm_medium || attribution.utm_campaign),
      has_page_url: Boolean(attribution.landing_page_url),
      has_referrer: Boolean(attribution.lead_referrer),
    },
  });
  if (error) throw new Error("Unable to write form submission audit record");

  return { status: "succeeded" as const, hubspotContactId: saved.id };
}
