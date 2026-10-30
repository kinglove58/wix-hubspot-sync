import { z } from "zod";

const optionalSecret = z.string().trim().optional();

const envSchema = z.object({
  APP_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  HUBSPOT_CLIENT_ID: optionalSecret,
  HUBSPOT_CLIENT_SECRET: optionalSecret,
  HUBSPOT_REDIRECT_URI: z.string().url().default("http://localhost:3000/api/oauth/hubspot/callback"),
  HUBSPOT_SCOPES: z.string().default("crm.objects.contacts.read crm.objects.contacts.write"),
  WIX_APP_ID: optionalSecret,
  WIX_APP_SECRET: optionalSecret,
  WIX_WEBHOOK_SECRET: optionalSecret,
  TOKEN_ENCRYPTION_KEY: optionalSecret,
});

export const env = envSchema.parse({
  APP_URL: process.env.APP_URL,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  HUBSPOT_CLIENT_ID: process.env.HUBSPOT_CLIENT_ID,
  HUBSPOT_CLIENT_SECRET: process.env.HUBSPOT_CLIENT_SECRET,
  HUBSPOT_REDIRECT_URI: process.env.HUBSPOT_REDIRECT_URI,
  HUBSPOT_SCOPES: process.env.HUBSPOT_SCOPES,
  WIX_APP_ID: process.env.WIX_APP_ID,
  WIX_APP_SECRET: process.env.WIX_APP_SECRET,
  WIX_WEBHOOK_SECRET: process.env.WIX_WEBHOOK_SECRET,
  TOKEN_ENCRYPTION_KEY: process.env.TOKEN_ENCRYPTION_KEY,
});
