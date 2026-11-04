import { z } from "zod";
import { validateMappings } from "@/lib/sync/mapping";

export const mappingConfigurationSchema = z.object({
  instanceId: z.string().min(1).max(512), pairId: z.uuid().optional(),
  mappings: z.array(z.object({
    wixField: z.string().trim().min(1).max(120).regex(/^info\.[A-Za-z0-9_.]+$/),
    hubspotProperty: z.string().trim().min(1).max(120).regex(/^[A-Za-z][A-Za-z0-9_]*$/),
    direction: z.enum(["wix_to_hubspot", "hubspot_to_wix", "bidirectional"]),
    transform: z.enum(["none", "trim", "lowercase", "uppercase"]).default("none"),
    enabled: z.boolean().default(true), allowEmpty: z.boolean().default(false),
  })).max(100),
});

export function storedMappingErrors(mappings: z.infer<typeof mappingConfigurationSchema>["mappings"]): string[] {
  const pairs = new Set<string>(); const errors: string[] = [];
  for (const mapping of mappings) {
    const key = `${mapping.wixField.toLowerCase()}::${mapping.hubspotProperty.toLowerCase()}`;
    if (pairs.has(key)) errors.push("Duplicate Wix-to-HubSpot field pair");
    pairs.add(key);
  }
  return [...errors, ...validateMappings(mappings.map((mapping) => ({
    sourceField: mapping.wixField, targetField: mapping.hubspotProperty,
    direction: mapping.direction === "bidirectional" ? "both" : mapping.direction,
    transform: mapping.transform, allowEmpty: mapping.allowEmpty,
  })))];
}
