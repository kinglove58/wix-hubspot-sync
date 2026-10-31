import "server-only";

const WIX_API = "https://www.wixapis.com";

export async function getWixInstanceToken(appId: string, appSecret: string, instanceId: string): Promise<{ access_token: string; expires_in: number }> {
  const response = await fetch(`${WIX_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grant_type: "client_credentials", client_id: appId, client_secret: appSecret, instance_id: instanceId }),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Wix token request failed (${response.status})`);
  return response.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function wixRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${WIX_API}${path}`, {
    ...init,
    headers: { Authorization: token, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Wix API ${response.status}: ${body.slice(0, 500)}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export interface WixContact {
  id?: string;
  info?: { name?: { first?: string; last?: string }; emails?: Array<{ email?: string }>; phones?: Array<{ phone?: string }> };
  revision?: string;
  updatedDate?: string;
}

export async function createWixContact(token: string, fields: Record<string, unknown>) {
  const info = {
    name: { first: fields.firstName ?? fields.firstname ?? "", last: fields.lastName ?? fields.lastname ?? "" },
    emails: fields.email ? [{ email: String(fields.email) }] : [],
    phones: fields.phone ? [{ phone: String(fields.phone) }] : [],
  };
  return wixRequest<{ contact?: WixContact }>(token, "/contacts/v4/contacts", {
    method: "POST", body: JSON.stringify({ info, allowDuplicates: false }),
  });
}

export async function updateWixContact(token: string, contactId: string, fields: Record<string, unknown>, revision?: string) {
  const info = {
    name: { first: fields.firstName ?? fields.firstname, last: fields.lastName ?? fields.lastname },
    emails: fields.email ? [{ email: String(fields.email) }] : undefined,
    phones: fields.phone ? [{ phone: String(fields.phone) }] : undefined,
  };
  return wixRequest<{ contact?: WixContact }>(token, `/contacts/v4/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH", body: JSON.stringify({ revision, info }),
  });
}
