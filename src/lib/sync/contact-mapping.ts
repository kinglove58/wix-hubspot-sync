import type { WixContact } from "@/lib/providers/wix/contacts";
import type { HubSpotContact } from "@/lib/providers/hubspot/client";
import type { StoredFieldMapping } from "@/lib/sync/mapping-repository";
import { hubSpotContactToWixInfo, wixContactToHubSpotProperties } from "@/lib/sync/normalize";
import { canonicalWixPath, mapHubSpotPayloadToWix, mapWixPayloadToHubSpot } from "@/lib/sync/provider-mapping";

const defaultPaths: Record<string, string> = {
  email: "info.emails.items.0.email", firstname: "info.name.first", lastname: "info.name.last",
  phone: "info.phones.items.0.phone", company: "info.company", jobtitle: "info.jobTitle",
};

export function mergedWixProperties(contact: WixContact, mappings: StoredFieldMapping[], useDefaults = true): Record<string, string> {
  if ((!mappings.length && !useDefaults) || mappings.length && mappings.every((m) => !m.enabled)) return {};
  const output = wixContactToHubSpotProperties(contact);
  for (const m of mappings) {
    if (!m.enabled || m.direction === "hubspot_to_wix") delete output[m.targetField];
  }
  const custom = mapWixPayloadToHubSpot(contact as Record<string, unknown>, mappings);
  for (const [key, value] of Object.entries(custom)) {
    if (typeof value === "object" && value !== null) throw new Error("HubSpot mappings must resolve to scalar values");
    if (value !== undefined) output[key] = value === null ? "" : String(value);
  }
  return Object.fromEntries(Object.entries(output).filter(([key, value]) => value.trim() !== "" || mappings.some((m) => m.enabled && m.allowEmpty && m.targetField === key)));
}

export function mergedHubSpotInfo(contact: HubSpotContact, mappings: StoredFieldMapping[], useDefaults = true): NonNullable<WixContact["info"]> {
  if ((!mappings.length && !useDefaults) || mappings.length && mappings.every((m) => !m.enabled)) return {};
  const properties = Object.fromEntries(Object.entries(contact.properties ?? {}).filter(([, value]) => typeof value === "string" && value.trim() !== ""));
  for (const m of mappings) {
    const canonical = canonicalWixPath(m.sourceField);
    if (!m.enabled || m.direction === "wix_to_hubspot") {
      for (const [property, path] of Object.entries(defaultPaths)) if (path === canonical) delete properties[property];
    }
  }
  const defaults = hubSpotContactToWixInfo({ ...contact, properties });
  const custom = mapHubSpotPayloadToWix(contact.properties ?? {}, mappings);
  function merge(base: unknown, patch: unknown): unknown {
    if (patch === null) return ""; // An explicitly allowed clear on a scalar field.
    if (Array.isArray(patch)) {
      const out = Array.isArray(base) ? [...base] : [];
      patch.forEach((value, index) => { out[index] = merge(out[index], value); });
      return out;
    }
    if (patch && typeof patch === "object") {
      const out: Record<string, unknown> = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
      for (const [key, value] of Object.entries(patch)) out[key] = merge(out[key], value);
      return out;
    }
    return patch;
  }
  return merge(defaults, custom) as NonNullable<WixContact["info"]>;
}
