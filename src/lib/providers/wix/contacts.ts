import "server-only";

import { getWixAccessToken } from "@/lib/providers/wix/client";

const WIX_API_BASE = "https://www.wixapis.com";

export interface WixContact {
  id?: string;
  revision?: number;
  info?: {
    name?: { first?: string; last?: string };
    emails?: Array<{ email?: string; primary?: boolean }>;
    phones?: Array<{ phone?: string; primary?: boolean }>;
    company?: string;
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
  const token = await getWixAccessToken(instanceId);
  const response = await fetch(`${WIX_API_BASE}${path}`, {
    ...init,
    headers: {
      authorization: token.access_token,
      "content-type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`Wix API request failed with status ${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function queryWixContacts(
  instanceId: string,
  cursor?: string,
): Promise<{ contacts?: WixContact[]; pagingMetadata?: { tooManyToReturn?: boolean; count?: number; cursors?: { next?: string } } }> {
  const body: Record<string, unknown> = {
    query: {
      paging: { limit: 100 },
      sort: [{ fieldName: "updatedDate", order: "DESC" }],
    },
  };
  if (cursor) (body.query as Record<string, unknown>).cursorPaging = { cursor };
  return wixRequest(instanceId, "/contacts/v4/contacts/query", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getWixContact(instanceId: string, contactId: string): Promise<WixContact> {
  const response = await wixRequest<{ contact?: WixContact }>(instanceId, `/contacts/v4/contacts/${encodeURIComponent(contactId)}`);
  if (!response.contact) throw new Error("Wix contact response did not include a contact");
  return response.contact;
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
  return response.contact;
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
  return response.contact;
}
