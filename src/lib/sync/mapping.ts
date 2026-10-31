export type FieldTransform = "none" | "trim" | "lowercase" | "uppercase";

export interface FieldMapping {
  sourceField: string;
  targetField: string;
  direction: "wix_to_hubspot" | "hubspot_to_wix" | "both";
  transform: FieldTransform;
}

export function transformValue(value: unknown, transform: FieldTransform): unknown {
  if (value == null || typeof value !== "string") return value;

  switch (transform) {
    case "trim":
      return value.trim();
    case "lowercase":
      return value.toLowerCase();
    case "uppercase":
      return value.toUpperCase();
    case "none":
    default:
      return value;
  }
}

/**
 * Validate destination collisions in each actual sync direction.
 * A bidirectional mapping occupies a destination on both providers:
 * targetField in HubSpot and sourceField in Wix.
 */
export function validateMappings(mappings: FieldMapping[]): string[] {
  const errors: string[] = [];
  const destinations = new Map<string, number>();

  mappings.forEach((mapping, index) => {
    const prefix = `Mapping ${index + 1}`;
    const source = mapping.sourceField.trim();
    const target = mapping.targetField.trim();

    if (!source) errors.push(`${prefix}: source field is required`);
    if (!target) errors.push(`${prefix}: target field is required`);
    if (!["none", "trim", "lowercase", "uppercase"].includes(mapping.transform)) {
      errors.push(`${prefix}: unsupported transform`);
    }
    if (!["wix_to_hubspot", "hubspot_to_wix", "both"].includes(mapping.direction)) {
      errors.push(`${prefix}: unsupported sync direction`);
      return;
    }
    if (!source || !target) return;

    const directions = mapping.direction === "both"
      ? ["wix_to_hubspot", "hubspot_to_wix"] as const
      : [mapping.direction] as const;

    let duplicate = false;
    for (const direction of directions) {
      const destination = direction === "wix_to_hubspot" ? target : source;
      const key = `${direction}:${destination.toLowerCase()}`;
      if (destinations.has(key)) duplicate = true;
      else destinations.set(key, index);
    }

    if (duplicate) {
      errors.push(`${prefix}: duplicate destination field for the configured sync direction`);
    }
  });

  return errors;
}

/** Map one provider payload to the other without mutating the original object. */
export function applyMappings(
  source: Record<string, unknown>,
  mappings: FieldMapping[],
  direction: "wix_to_hubspot" | "hubspot_to_wix",
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const mapping of mappings) {
    if (mapping.direction !== "both" && mapping.direction !== direction) continue;
    if (!(mapping.sourceField in source)) continue;
    output[mapping.targetField] = transformValue(source[mapping.sourceField], mapping.transform);
  }

  return output;
}
