import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { TestDatabase, migratedTestDatabase } from "./support/database";
import { ProviderFixture } from "./support/providers";
const m = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: () => m.db }));
import { encryptToken } from "../src/lib/security/token-crypto";
import { POST as wixReceiver } from "../src/app/api/webhooks/wix/route";
import { POST as hubspotReceiver } from "../src/app/api/webhooks/hubspot/route";
import { processWebhookEvent } from "../src/lib/webhooks/processor";

describe("signed webhook → PostgreSQL → worker → mocked provider workflows", () => {
  let pg: PGlite;
  let providers: ProviderFixture;
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  beforeAll(async () => { pg = await migratedTestDatabase(); m.db = new TestDatabase(pg); }, 30_000);
  afterAll(async () => { await pg.close(); });
  beforeEach(async () => {
    const tables = (await pg.query<{ tablename: string }>("select tablename from pg_tables where schemaname='public'")).rows;
    await pg.exec(`truncate ${tables.map((t) => `public."${t.tablename}"`).join(",")}`);
    vi.stubEnv("TOKEN_ENCRYPTION_KEY", "11".repeat(32));
    vi.stubEnv("WIX_WEBHOOK_PUBLIC_KEY", publicKey); vi.stubEnv("HUBSPOT_CLIENT_SECRET", "synthetic-client-secret");
    providers = new ProviderFixture(); vi.stubGlobal("fetch", providers.fetch);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  async function connect(provider: "wix" | "hubspot", account: string) {
    const result = await pg.query<{ id: string }>("insert into public.provider_connections(provider,external_account_id,encrypted_access_token,token_expires_at) values ($1,$2,$3,now()+interval '1 hour') returning id", [provider, account, encryptToken(`${provider}:${account}`)]);
    return result.rows[0].id;
  }
  async function pair(wix: string, hubspot: string) {
    await pg.query("insert into public.integration_pairs(wix_connection_id,hubspot_connection_id) values ($1,$2)", [wix, hubspot]);
  }
  async function wixEvent(site: string, id = "source", eventId = "event-1", type = "wix.contacts.v4.contact_created") {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, data: { instanceId: site, eventType: type, data: JSON.stringify({ id: eventId, entityId: id }) } })).toString("base64url");
    const signer = createSign("RSA-SHA256"); signer.update(`${header}.${payload}`); signer.end();
    const response = await wixReceiver(new NextRequest("https://sync.example.invalid/api/webhooks/wix", { method: "POST", body: `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}` }));
    expect(response.status).toBe(200);
  }
  async function hubspotEvent(portal: string, id: string, eventId = "hub-event") {
    const url = "https://sync.example.invalid/api/webhooks/hubspot";
    const body = JSON.stringify([{ portalId: portal, objectId: id, eventId, occurredAt: Date.now(), subscriptionType: "object.creation", objectTypeId: "0-1" }]);
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", "synthetic-client-secret").update(`POST${url}${body}${timestamp}`).digest("base64");
    expect((await hubspotReceiver(new NextRequest(url, { method: "POST", body, headers: { "x-hubspot-signature-v3": signature, "x-hubspot-request-timestamp": timestamp } }))).status).toBe(202);
  }
  async function newest() { return (await pg.query<{ id: string }>("select id from public.webhook_events order by received_at desc limit 1")).rows[0].id; }

  it("creates, links and audits Wix contacts, deduplicates deliveries, and updates changed emails", async () => {
    await pair(await connect("wix", "site-a"), await connect("hubspot", "100")); providers.addWix("site-a");
    await wixEvent("site-a"); await wixEvent("site-a");
    expect((await pg.query("select id from public.webhook_events")).rows).toHaveLength(1);
    const id = await newest();
    expect(await processWebhookEvent(id)).toBe("succeeded");
    expect(await processWebhookEvent(id)).toBe("ignored");
    expect(providers.writes).toHaveLength(1);
    const link = (await pg.query<{ hubspot_contact_id: string }>("select * from public.contact_links")).rows[0];
    const source = providers.wix.get("site-a")!.get("source")!;
    source.info!.emails!.items[0].email = "changed@example.invalid"; source.updatedDate = providers.now();
    await wixEvent("site-a", "source", "event-2", "wix.contacts.v4.contact_updated");
    expect(await processWebhookEvent(await newest())).toBe("succeeded");
    expect(providers.hubspot.get("100")!.size).toBe(1);
    expect(providers.hubspot.get("100")!.get(link.hubspot_contact_id)?.properties?.email).toBe("changed@example.invalid");
    expect((await pg.query("select * from public.sync_audit_logs where outcome='succeeded'")).rows).toHaveLength(2);
  });

  it("creates Wix contacts from HubSpot and suppresses the reciprocal provider timestamp echo", async () => {
    await pair(await connect("wix", "site-a"), await connect("hubspot", "100")); providers.addHubSpot("100");
    await hubspotEvent("100", "source"); expect(await processWebhookEvent(await newest())).toBe("succeeded");
    const id = [...providers.wix.get("site-a")!.keys()][0];
    expect((await pg.query("select * from public.contact_links")).rows).toHaveLength(1);
    await wixEvent("site-a", id);
    expect(await processWebhookEvent(await newest())).toBe("ignored");
    expect(providers.writes).toHaveLength(1);
  });

  it("fans out only over explicit pairs and isolates identical emails and contact IDs", async () => {
    const a = await connect("wix", "site-a"), b = await connect("wix", "site-b");
    const x = await connect("hubspot", "100"), y = await connect("hubspot", "200");
    await pair(a, x); await pair(a, y); await pair(b, y);
    providers.addWix("site-a"); providers.addWix("site-b");
    await wixEvent("site-a"); await processWebhookEvent(await newest());
    expect(providers.hubspot.get("100")!.size).toBe(1); expect(providers.hubspot.get("200")!.size).toBe(1);
    await wixEvent("site-b"); await processWebhookEvent(await newest());
    expect((await pg.query("select * from public.contact_links")).rows).toHaveLength(3);
    expect(providers.writes.filter((w) => w.account === "100")).toHaveLength(1);
  });

  it("reschedules rate limits and terminalizes permanent validation failures", async () => {
    await pair(await connect("wix", "site-a"), await connect("hubspot", "100")); providers.addWix("site-a");
    providers.failNextStatus = 429; await wixEvent("site-a"); const id = await newest();
    await expect(processWebhookEvent(id)).rejects.toThrow();
    const failed = (await pg.query<{ status: string; terminal: boolean; next_attempt_at: string }>("select * from public.webhook_events where id=$1", [id])).rows[0];
    expect(failed.status).toBe("failed"); expect(failed.terminal).toBe(false); expect(Date.parse(failed.next_attempt_at)).toBeGreaterThan(Date.now());
    await pg.query("update public.webhook_events set next_attempt_at=now()-interval '1 second' where id=$1", [id]);
    await processWebhookEvent(id); expect(providers.writes).toHaveLength(1);
    providers.addWix("site-a", "bad", "bad@example.invalid"); providers.failNextStatus = 400; await wixEvent("site-a", "bad", "bad-event");
    await expect(processWebhookEvent(await newest())).rejects.toThrow();
    expect((await pg.query<{ terminal: boolean }>("select terminal from public.webhook_events where id=$1", [await newest()])).rows[0].terminal).toBe(true);
    expect(await processWebhookEvent(await newest())).toBe("ignored");
  });

  it("fans out a shared portal only to its two explicitly paired sites", async () => {
    const a = await connect("wix", "site-a"), b = await connect("wix", "site-b");
    await connect("wix", "unrelated-site");
    const portal = await connect("hubspot", "100");
    await pair(a, portal); await pair(b, portal);
    providers.addHubSpot("100");
    await hubspotEvent("100", "source");
    expect(await processWebhookEvent(await newest())).toBe("succeeded");
    expect(providers.writes.map((write) => write.account).sort()).toEqual(["site-a", "site-b"]);
    expect(providers.wix.has("unrelated-site")).toBe(false);
    expect((await pg.query("select * from public.contact_links")).rows).toHaveLength(2);
  });

  it("concurrent deliveries for one contact create only one destination identity", async () => {
    await pair(await connect("wix", "site-a"), await connect("hubspot", "100")); providers.addWix("site-a");
    await wixEvent("site-a", "source", "concurrent-a");
    await wixEvent("site-a", "source", "concurrent-b");
    const events = (await pg.query<{ id: string }>("select id from public.webhook_events")).rows;
    const results = await Promise.all(events.map((event) => processWebhookEvent(event.id)));
    expect(results).toContain("succeeded");
    expect(providers.writes.filter((write) => write.method === "POST")).toHaveLength(1);
    expect((await pg.query("select * from public.contact_links")).rows).toHaveLength(1);
    expect((await pg.query<{ attempts: number }>("select attempts from public.webhook_events where status='pending'")).rows.every((row) => row.attempts === 0)).toBe(true);
  });

  it("preserves history and blocks writes after uninstall", async () => {
    await pair(await connect("wix", "site-a"), await connect("hubspot", "100")); providers.addWix("site-a");
    await wixEvent("site-a"); await processWebhookEvent(await newest());
    await wixEvent("site-a", "source", "uninstalled", "AppRemoved");
    await wixEvent("site-a", "source", "late-event");
    expect(await processWebhookEvent(await newest())).toBe("ignored");
    expect((await pg.query("select * from public.contact_links")).rows).toHaveLength(1);
    expect(providers.writes).toHaveLength(1);
  });
});
