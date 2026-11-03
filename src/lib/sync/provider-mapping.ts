import type { FieldMapping } from "@/lib/sync/mapping";
import { applyNestedMappings } from "@/lib/sync/nested-mapping";
import type { StoredFieldMapping } from "@/lib/sync/mapping-repository";

/** Apply only Wix→HubSpot and bidirectional mappings. */
export function mapWixPayloadToHubSpot(
  wixContact: Record<string, unknown>,
  mappings: StoredFieldMapping[],
): Record<string, unknown> {
  return applyNestedMappings(
    wixContact,
    mappings.filter((mapping) => mapping.enabled && (mapping.direction === "wix_to_hubspot" || mapping.direction === "both"))
      .map((mapping) => ({ ...mapping, sourceField: canonicalWixPath(mapping.sourceField) })),
    "wix_to_hubspot",
  );
}

/** Reverse only HubSpot→Wix and bidirectional mappings. */
export function mapHubSpotPayloadToWix(
  hubspotProperties: Record<string, unknown>,
  mappings: StoredFieldMapping[],
): Record<string, unknown> {
  const reversed: FieldMapping[] = mappings
    .filter((mapping) => mapping.enabled && (mapping.direction === "hubspot_to_wix" || mapping.direction === "both"))
    .map((mapping) => ({
      sourceField: mapping.targetField,
      targetField: canonicalWixPath(mapping.sourceField).replace(/^info\./, ""),
      direction: mapping.direction === "both" ? "both" : "hubspot_to_wix",
      transform: mapping.transform,
      allowEmpty: mapping.allowEmpty,
    }));
  return applyNestedMappings(hubspotProperties, reversed, "hubspot_to_wix");
}

/** Preserve existing saved paths while using the REST v4 collection envelope. */
export function canonicalWixPath(path: string): string {
  return path.replace(/^info\.(emails|phones|addresses)\.(\d+)\./, "info.$1.items.$2.");
}
