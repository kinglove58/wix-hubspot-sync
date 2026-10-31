import "server-only";

import {
  createHubSpotContact,
  ensureHubSpotFormAttributionProperties,
  findHubSpotContactByEmail,
  updateHubSpotContact,
} from "@/lib/providers/hubspot/client";
import { resolveProviderConnections } from "@/lib/sync/connection-repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function flattenFields(data: UnknownRecord): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  const raw = data.fields ?? data.answers ?? data.formFields;
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
export async function syncWixFormSubmissionToHubSpot(instanceId: string, eventData: UnknownRecord) {
  await resolveProviderConnections(instanceId);
  const submission = record(eventData.submission);
  const context = record(eventData.submissionContext ?? eventData.context ?? submission.context);
  const fields = { ...flattenFields(eventData), ...flattenFields(submission) };

  const email = pick(fields, ["email", "emailAddress", "e-mail"]);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    await getSupabaseAdmin().from("sync_audit_logs").insert({
      provider: "wix", action: "form_submission", outcome: "skipped",
      safe_details: { reason: "valid_email_required" },
    });
    return { status: "skipped" as const, reason: "valid_email_required" };
  }

  const properties: Record<string, string> = { email };
  const firstName = pick(fields, ["firstName", "first_name", "givenName"]);
  const lastName = pick(fields, ["lastName", "last_name", "surname", "familyName"]);
  const phone = pick(fields, ["phone", "phoneNumber", "mobile"]);
  const company = pick(fields, ["company", "companyName", "organization"]);
  if (firstName) properties.firstname = firstName;
  if (lastName) properties.lastname = lastName;
  if (phone) properties.phone = phone;
  if (company) properties.company = company;

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

  const utm = record(eventData.utm ?? submission.utm ?? context.utm);
  const pageContext = record(eventData.page ?? context.page);
  const sourceObjects = [eventData, submission, context, utm, pageContext];
  const attribution: Record<string, string | undefined> = {
    utm_source: textAt(sourceObjects, ["utm_source", "utmSource"]),
    utm_medium: textAt(sourceObjects, ["utm_medium", "utmMedium"]),
    utm_campaign: textAt(sourceObjects, ["utm_campaign", "utmCampaign"]),
    utm_term: textAt(sourceObjects, ["utm_term", "utmTerm"]),
    utm_content: textAt(sourceObjects, ["utm_content", "utmContent"]),
    landing_page_url: textAt(sourceObjects, ["pageUrl", "pageURL", "landingPageUrl", "url"]),
    lead_referrer: textAt(sourceObjects, ["referrer", "referer", "referrerUrl"]),
    form_submitted_at: textAt(sourceObjects, ["submittedAt", "submissionTime", "createdDate", "timestamp"]) ?? new Date().toISOString(),
  };
  for (const [key, value] of Object.entries(attribution)) if (value) properties[key] = value;

  await ensureHubSpotFormAttributionProperties(customPropertyDefinitions);
  const existing = await findHubSpotContactByEmail(email);
  const saved = existing?.id
    ? await updateHubSpotContact(existing.id, properties)
    : await createHubSpotContact(properties);
  if (!saved.id) throw new Error("HubSpot did not return a contact ID");

  const { error } = await getSupabaseAdmin().from("sync_audit_logs").insert({
    provider: "wix",
    action: "wix_form_submission_to_hubspot",
    outcome: "succeeded",
    hubspot_contact_id: saved.id,
    safe_details: {
      source: "wix_form",
      has_utm: Boolean(attribution.utm_source || attribution.utm_medium || attribution.utm_campaign),
      has_page_url: Boolean(attribution.landing_page_url),
      has_referrer: Boolean(attribution.lead_referrer),
    },
  });
  if (error) throw new Error("Unable to write form submission audit record");

  return { status: "succeeded" as const, hubspotContactId: saved.id };
}
