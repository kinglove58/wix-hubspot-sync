import type { FieldMapping } from "@/lib/sync/mapping";
import { transformValue } from "@/lib/sync/mapping";

const isIndex = (segment: string) => /^\d+$/.test(segment) && Number(segment) <= 99;
const blockedSegments = new Set(["__proto__", "prototype", "constructor"]);

function readPath(source: Record<string, unknown>, path: string): unknown {
  let value: unknown = source;
  for (const segment of path.split(".")) {
    if (!segment || blockedSegments.has(segment)) return undefined;
    if (Array.isArray(value)) {
      if (!isIndex(segment)) return undefined;
      value = value[Number(segment)];
      continue;
    }
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[segment];
  }
  return value;
}

function getChild(container: Record<string, unknown> | unknown[], segment: string): unknown {
  return Array.isArray(container) ? container[Number(segment)] : container[segment];
}

function setChild(container: Record<string, unknown> | unknown[], segment: string, value: unknown): void {
  if (Array.isArray(container)) container[Number(segment)] = value;
  else container[segment] = value;
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  if (!parts.length || parts.length > 12 || parts.some((part) => !part || blockedSegments.has(part))) return;

  let cursor: Record<string, unknown> | unknown[] = target;
  for (let index = 0; index < parts.length; index += 1) {
    const segment = parts[index];
    if (Array.isArray(cursor) && !isIndex(segment)) return;
    if (index === parts.length - 1) {
      setChild(cursor, segment, value);
      return;
    }

    const nextIsIndex = isIndex(parts[index + 1]);
    let child = getChild(cursor, segment);
    if (!child || typeof child !== "object" || (Array.isArray(child) !== nextIsIndex)) {
      child = nextIsIndex ? [] : {};
      setChild(cursor, segment, child);
    }
    cursor = child as Record<string, unknown> | unknown[];
  }
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
    writePath(output, mapping.targetField, transformValue(value, mapping.transform));
  }
  return output;
}
