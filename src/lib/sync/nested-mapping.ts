import type { FieldMapping } from "@/lib/sync/mapping";
import { transformValue } from "@/lib/sync/mapping";

function readPath(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source;
  for (const segment of path.split(".")) {
    if (Array.isArray(value)) {
      if (!/^\\d+$/.test(segment)) return undefined;
      value = value[Number(segment)];
      continue;
    }
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

export function applyNestedMappings(
  source: Record<string, unknown>,
  mappings: FieldMapping[],
  direction: "wix_to_hubspot" | "hubspot_to_wix",
): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const mapping of mappings) {
    if (mapping.direction !== "both" && mapping.direction !== direction) continue;
    const value = readPath(source, mapping.sourceField);
    if (value === undefined) continue;

    const parts = mapping.targetField.split(".");
    if (parts.some((part) => !part.trim() || /^\\d+$/.test(part))) continue;
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
