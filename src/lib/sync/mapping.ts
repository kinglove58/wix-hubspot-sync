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

export function validateMappings(mappings: FieldMapping[]): string[] {
  const errors: string[] = [];
  const seenTargets = new Set<string>();

  mappings.forEach((mapping, index) => {
    const prefix = `Mapping ${index + 1}`;
    if (!mapping.sourceField.trim()) errors.push(`${prefix}: source field is required`);
    if (!mapping.targetField.trim()) errors.push(`${prefix}: target field is required`);
    if (!["none", "trim", "lowercase", "uppercase"].includes(mapping.transform)) {
      errors.push(`${prefix}: unsupported transform`);
    }

    const targetKey = `${mapping.direction}:${mapping.targetField.trim().toLowerCase()}`;
    if (mapping.targetField.trim() && seenTargets.has(targetKey)) {
      errors.push(`${prefix}: duplicate target field for direction ${mapping.direction}`);
    }
    if (mapping.targetField.trim()) seenTargets.add(targetKey);
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
