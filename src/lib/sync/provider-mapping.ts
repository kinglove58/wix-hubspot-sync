import type { FieldMapping } from "@/lib/sync/mapping";
import { applyNestedMappings } from "@/lib/sync/nested-mapping";
import type { StoredFieldMapping } from "@/lib/sync/mapping-repository";

/** Convert persisted Wix→HubSpot rows into a provider-neutral mapping list. */
export function mapWixPayloadToHubSpot(
  wixContact: Record<string, unknown>,
  mappings: StoredFieldMapping[],
): Record<string, unknown> {
  return applyNestedMappings(wixContact, mappings, "wix_to_hubspot");
}

/** Reverse the persisted Wix→HubSpot column pair for HubSpot→Wix updates. */
export function mapHubSpotPayloadToWix(
  hubspotProperties: Record<string, unknown>,
  mappings: StoredFieldMapping[],
): Record<string, unknown> {
  const reversed: FieldMapping[] = mappings.map((mapping) => ({
    sourceField: mapping.targetField,
    targetField: mapping.sourceField,
    direction: mapping.direction === "both" ? "both" : mapping.direction === "wix_to_hubspot" ? "hubspot_to_wix" : mapping.direction,
    transform: mapping.transform,
  }));
  return applyNestedMappings(hubspotProperties, reversed, "hubspot_to_wix");
}
