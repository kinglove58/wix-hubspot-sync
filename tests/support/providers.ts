import type { WixContact } from "../../src/lib/providers/wix/contacts";
import type { HubSpotContact } from "../../src/lib/providers/hubspot/client";

/** Synthetic provider state only; no external requests and no customer data. */
export class ProviderFixture {
  wix = new Map<string, Map<string, WixContact>>();
  hubspot = new Map<string, Map<string, HubSpotContact>>();
  writes: Array<{ provider: string; account: string; method: string; id: string }> = [];
  failNextStatus: number | null = null;
  private propertyNames = new Map<string, Set<string>>();
  private tick = 0;
  now() { return new Date(Date.UTC(2026, 0, 1, 10, 0, this.tick++)).toISOString(); }
  addWix(site: string, id = "source", email = "same@example.invalid") {
    const contacts = this.wix.get(site) ?? new Map();
    contacts.set(id, { id, revision: 1, updatedDate: this.now(), info: { name: { first: "Ada" }, emails: { items: [{ email, primary: true }] } } });
    this.wix.set(site, contacts);
  }
  addHubSpot(portal: string, id = "source", email = "same@example.invalid") {
    const contacts = this.hubspot.get(portal) ?? new Map();
    contacts.set(id, { id, updatedAt: this.now(), properties: { firstname: "Grace", email } });
    this.hubspot.set(portal, contacts);
  }
  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    const authorization = headers.get("authorization") ?? "";
    const account = authorization.replace(/^Bearer /, "").split(":")[1];
    if (!account) throw new Error("Provider request lacked scoped credentials");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
    if (url.hostname === "api.hubapi.com") {
      const contacts = this.hubspot.get(account) ?? new Map<string, HubSpotContact>();
      this.hubspot.set(account, contacts);
      if (url.pathname.startsWith("/crm/properties/")) {
        const names = this.propertyNames.get(account) ?? new Set(["email", "firstname", "lastname", "phone", "mobilephone", "company", "jobtitle", "website", "address", "city", "state", "zip", "country", "nickname"]);
        this.propertyNames.set(account, names);
        if (method === "POST") { names.add(String(body.name)); return Response.json(body); }
        return Response.json({ results: [...names].map((name) => ({ name, label: name, type: "string" })) });
      }
      if (url.pathname.endsWith("/search")) {
        const groups = body.filterGroups as Array<{ filters: Array<{ value: string }> }>;
        return Response.json({ results: [...contacts.values()].filter((contact) => contact.properties?.email === groups[0].filters[0].value) });
      }
      const id = decodeURIComponent(url.pathname.split("/").pop()!);
      if (method === "GET") return contacts.has(id) ? Response.json(contacts.get(id)) : new Response("", { status: 404 });
      if (this.failNextStatus) { const status = this.failNextStatus; this.failNextStatus = null; return new Response("", { status, headers: { "Retry-After": "120" } }); }
      const targetId = method === "POST" ? String(contacts.size + 100) : id;
      const contact = { ...contacts.get(targetId), id: targetId, updatedAt: this.now(), properties: { ...contacts.get(targetId)?.properties, ...body.properties as Record<string, string> } };
      contacts.set(targetId, contact); this.writes.push({ provider: "hubspot", account, method, id: targetId });
      return Response.json(contact);
    }
    if (url.hostname !== "www.wixapis.com") throw new Error("Unexpected external request blocked");
    const contacts = this.wix.get(account) ?? new Map<string, WixContact>();
    this.wix.set(account, contacts);
    if (url.pathname.endsWith("/query")) {
      const query = body.query as { filter: { "info.emails.email": { $eq: string } } };
      return Response.json({ contacts: [...contacts.values()].filter((contact) => contact.info?.emails?.items.some((entry) => entry.email === query.filter["info.emails.email"].$eq)) });
    }
    const id = decodeURIComponent(url.pathname.split("/").pop()!);
    if (method === "GET") return contacts.has(id) ? Response.json({ contact: contacts.get(id) }) : new Response("", { status: 404 });
    if (this.failNextStatus) { const status = this.failNextStatus; this.failNextStatus = null; return new Response("", { status }); }
    const existing = contacts.get(id);
    if (method === "PATCH" && existing?.revision !== body.revision) return new Response("", { status: 428 });
    const targetId = method === "POST" ? `created-${contacts.size + 1}` : id;
    const contact: WixContact = { id: targetId, revision: (existing?.revision ?? 0) + 1, updatedDate: this.now(), info: body.info as WixContact["info"] };
    contacts.set(targetId, contact); this.writes.push({ provider: "wix", account, method, id: targetId });
    return Response.json({ contact });
  };
}
