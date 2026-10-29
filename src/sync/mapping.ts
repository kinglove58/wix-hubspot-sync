import type { FieldMapping } from "./types";

export function applyTransform(
  value: unknown,
  transform: FieldMapping["transform"],
): unknown {
  if (value == null || transform == null || transform === "none") return value;
  if (typeof value !== "string") return value;

  switch (transform) {
    case "trim":
      return value.trim();
    case "lowercase":
      return value.toLowerCase();
    case "uppercase":
      return value.toUpperCase();
    default:
      return value;
  }
}

export function validateMappings(mappings: FieldMapping[]): string[] {
  const errors: string[] = [];
  const seenWixFields = new Set<string>();
  const seenHubSpotProperties = new Set<string>();

  for (const [index, mapping] of mappings.entries()) {
    const wixField = mapping.wixField.trim();
    const hubspotProperty = mapping.hubspotProperty.trim();

    if (!wixField) errors.push(`Mapping ${index + 1}: Wix field is required.`);
    if (!hubspotProperty) errors.push(`Mapping ${index + 1}: HubSpot property is required.`);

    if (mapping.enabled && wixField && hubspotProperty) {
      const pair = `${wixField.toLowerCase()}::${hubspotProperty.toLowerCase()}`;
      if (seenWixFields.has(pair)) {
        errors.push(`Mapping ${index + 1}: duplicate Wix/HubSpot field pair.`);
      }
      seenWixFields.add(pair);
    }

    if (mapping.enabled && mapping.direction === "bidirectional") {
      const key = wixField.toLowerCase();
      if (seenHubSpotProperties.has(key)) {
        errors.push(`Mapping ${index + 1}: ambiguous bidirectional mapping for Wix field "${wixField}".`);
      }
      seenHubSpotProperties.add(key);
    }
  }

  return errors;
}

export function mapProperties(
  source: Record<string, unknown>,
  mappings: FieldMapping[],
  direction: "wix_to_hubspot" | "hubspot_to_wix",
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const mapping of mappings) {
    if (!mapping.enabled) continue;
    if (mapping.direction !== "bidirectional" && mapping.direction !== direction) continue;

    const sourceField = direction === "wix_to_hubspot"
      ? mapping.wixField
      : mapping.hubspotProperty;
    const destinationField = direction === "wix_to_hubspot"
      ? mapping.hubspotProperty
      : mapping.wixField;

    if (Object.prototype.hasOwnProperty.call(source, sourceField)) {
      output[destinationField] = applyTransform(source[sourceField], mapping.transform);
    }
  }

  return output;
}
