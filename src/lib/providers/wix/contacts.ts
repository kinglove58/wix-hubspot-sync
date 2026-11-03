import "server-only";

import { getWixAccessToken } from "@/lib/providers/wix/client";
import { ProviderApiError, ProviderPreflightError } from "@/lib/providers/api-error";
import { z } from "zod";
import { assertIntegrationLease, integrationWorkSignal } from "@/lib/sync/lease";

const WIX_API_BASE = "https://www.wixapis.com";

const wixContactSchema = z.object({
  id: z.string().min(1),
  revision: z.number().int().nonnegative().optional(),
  createdDate: z.string().optional(), updatedDate: z.string().optional(),
  info: z.object({
    name: z.object({ first: z.string().optional(), last: z.string().optional() }).passthrough().optional(),
    emails: z.object({ items: z.array(z.object({ email: z.string().optional(), primary: z.boolean().optional() }).passthrough()) }).optional(),
    phones: z.object({ items: z.array(z.object({ phone: z.string().optional(), primary: z.boolean().optional(), tag: z.string().optional() }).passthrough()) }).optional(),
  }).passthrough().optional(),
}).passthrough();

function parseWixContact(value: unknown): WixContact {
  const result = wixContactSchema.safeParse(value);
  if (!result.success) throw new Error("Wix returned a malformed contact");
  return result.data as WixContact;
}

export interface WixContact {
  id?: string;
  revision?: number;
  info?: {
    name?: { first?: string; last?: string };
    emails?: { items: Array<{ email?: string; primary?: boolean }> };
    phones?: { items: Array<{ phone?: string; primary?: boolean; tag?: string }> };
    addresses?: { items: Array<{ address?: { country?: string; subdivision?: string; city?: string; postalCode?: string; addressLine?: string; addressLine2?: string; streetAddress?: { name?: string; number?: string } } }> };
    company?: string;
    jobTitle?: string;
    [key: string]: unknown;
  };
  createdDate?: string;
  updatedDate?: string;
  [key: string]: unknown;
}

async function wixRequest<T>(
  instanceId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let token: Awaited<ReturnType<typeof getWixAccessToken>>;
  try { token = await getWixAccessToken(instanceId); }
  catch (error) { throw new ProviderPreflightError(error); }
  if (init.method && !["GET", "HEAD"].includes(init.method)) await assertIntegrationLease();
  const response = await fetch(`${WIX_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: token.access_token,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
    signal: AbortSignal.any([AbortSignal.timeout(15_000), integrationWorkSignal()]),
  });
  if (!response.ok) {
    throw new ProviderApiError("wix", response.status, response.headers.get("retry-after"));
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function queryWixContacts(
  instanceId: string,
  offset = 0,
): Promise<{ contacts?: WixContact[]; pagingMetadata?: { tooManyToReturn?: boolean; count?: number; offset?: number; total?: number } }> {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid Wix contact offset");
  const body: Record<string, unknown> = {
    query: {
      paging: { limit: 100, offset },
      sort: [{ fieldName: "updatedDate", order: "DESC" }],
    },
  };
  const response = await wixRequest<{ contacts?: unknown[]; pagingMetadata?: { count?: number; offset?: number; total?: number; tooManyToReturn?: boolean } }>(instanceId, "/contacts/v4/contacts/query", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return { ...response, contacts: response.contacts?.map(parseWixContact) };
}

export async function findWixContactByEmail(instanceId: string, email: string): Promise<WixContact | undefined> {
  const response = await wixRequest<{ contacts?: WixContact[] }>(instanceId, "/contacts/v4/contacts/query", {
    method: "POST",
    body: JSON.stringify({ query: { filter: { "info.emails.email": { $eq: email.trim().toLowerCase() } }, paging: { limit: 2 } } }),
  });
  const matches = response.contacts?.map(parseWixContact).filter((contact) =>
    contact.info?.emails?.items.some((entry) => entry.email?.trim().toLowerCase() === email.trim().toLowerCase())
  ) ?? [];
  if (matches.length > 1) throw new Error("Ambiguous Wix email match");
  return matches[0];
}

export async function getWixContact(instanceId: string, contactId: string): Promise<WixContact> {
  const response = await wixRequest<{ contact?: WixContact }>(instanceId, `/contacts/v4/contacts/${encodeURIComponent(contactId)}`);
  if (!response.contact) throw new Error("Wix contact response did not include a contact");
  return parseWixContact(response.contact);
}

export async function createWixContact(
  instanceId: string,
  info: NonNullable<WixContact["info"]>,
): Promise<WixContact> {
  const response = await wixRequest<{ contact?: WixContact }>(instanceId, "/contacts/v4/contacts", {
    method: "POST",
    body: JSON.stringify({ info }),
  });
  if (!response.contact) throw new Error("Wix create response did not include a contact");
  return parseWixContact(response.contact);
}

export async function updateWixContact(
  instanceId: string,
  contactId: string,
  revision: number,
  info: NonNullable<WixContact["info"]>,
): Promise<WixContact> {
  const response = await wixRequest<{ contact?: WixContact }>(instanceId, `/contacts/v4/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    body: JSON.stringify({ revision, info }),
  });
  if (!response.contact) throw new Error("Wix update response did not include a contact");
  return parseWixContact(response.contact);
}
