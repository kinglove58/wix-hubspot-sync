import { z } from "zod";

const serverEnvSchema = z.object({
  APP_BASE_URL: z.string().url().default("http://localhost:3000"),
  SUPABASE_URL: z.string().url().optional().or(z.literal("")),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  HUBSPOT_CLIENT_ID: z.string().optional(),
  HUBSPOT_CLIENT_SECRET: z.string().optional(),
  HUBSPOT_REDIRECT_URI: z.string().url().default("http://localhost:3000/api/oauth/hubspot/callback"),
  HUBSPOT_SCOPES: z.string().default("crm.objects.contacts.read crm.objects.contacts.write crm.schemas.contacts.read crm.schemas.contacts.write"),
  WIX_APP_ID: z.string().optional(),
  WIX_APP_SECRET: z.string().optional(),
  WIX_WEBHOOK_PUBLIC_KEY: z.string().optional(),
  WIX_INSTANCE_ID: z.string().optional(),
  TOKEN_ENCRYPTION_KEY: z.string().optional(),
  ADMIN_API_KEY: z.string().optional(),
  DASHBOARD_PASSWORD: z.string().optional(),
  SESSION_SECRET: z.string().optional(),
  CRON_SECRET: z.string().optional(),
});

export function getServerEnv() { return serverEnvSchema.parse(process.env); }
export function requireEnv(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}
