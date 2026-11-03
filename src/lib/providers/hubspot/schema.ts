import { z } from "zod";

export const hubSpotTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().int().positive().max(31_536_000),
  hub_id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  scopes: z.array(z.string()).optional(),
});

export const hubSpotContactSchema = z.object({
  id: z.string().min(1),
  properties: z.record(z.string(), z.string().nullable()).optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough();
