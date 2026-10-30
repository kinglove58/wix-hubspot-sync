import type { FieldMapping } from "@/lib/sync/mapping";
import { transformValue } from "@/lib/sync/mapping";

export function applyNestedMappings(
  source: Record<string, unknown>,
  mappings: FieldMapping[],
  direction: "wix_to_hubspot" | "hubspot_to_wix",
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const mapping of mappings) {
    if (mapping.direction !== "both" && mapping.direction !== direction) continue;

    let value: unknown = source;
    for (const segment of mapping.sourceField.split(".")) {
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        value = undefined;
        break;
      }
      value = (value as Record<string, unknown>)[segment];
    }
    if (value === undefined) continue;

    const parts = mapping.targetField.split(".");
    if (parts.some((part) => !part.trim())) continue;
    let cursor = output;
    for (const part of parts.slice(0, -1)) {
      const child = cursor[part];
      if (!child || typeof child !== "object" || Array.isArray(child)) cursor[part] = {};
      cursor = cursor[part] as Record<string, unknown>;
    }
    cursor[parts[parts.length - 1]] = transformValue(value, mapping.transform);
  }

  return output;
}
