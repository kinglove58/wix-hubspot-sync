import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ persist: vi.fn(), admin: vi.fn(), rpc: vi.fn() }));
vi.mock("../src/lib/webhooks/event-store", () => ({ persistVerifiedWebhookEvent: m.persist }));
vi.mock("../src/lib/supabase/admin", () => ({ getSupabaseAdmin: m.admin }));
import { POST as wixWebhook } from "../src/app/api/webhooks/wix/route";
import { POST as hubspotWebhook } from "../src/app/api/webhooks/hubspot/route";

describe("webhook route security and persistence", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("WIX_WEBHOOK_PUBLIC_KEY", publicKey); vi.stubEnv("HUBSPOT_CLIENT_SECRET", "test-secret");
    m.persist.mockResolvedValue({ id: "internal-event", duplicate: false });
    m.rpc.mockResolvedValue({ data: null, error: null }); m.admin.mockReturnValue({ rpc: m.rpc });
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  function wixRequest(type: string, data: Record<string, unknown>) {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + 300, data: JSON.stringify({ instanceId: "site", eventType: type, data: JSON.stringify(data) }) })).toString("base64url");
    const sign = createSign("RSA-SHA256"); sign.update(`${header}.${payload}`); sign.end();
    return new NextRequest("https://sync.example.invalid/api/webhooks/wix", { method: "POST", body: `${header}.${payload}.${sign.sign(privateKey).toString("base64url")}` });
  }
  function hubspotRequest(payload: unknown, valid = true) {
    const url = "https://sync.example.invalid/api/webhooks/hubspot";
    const body = JSON.stringify(payload); const timestamp = String(Date.now());
    const signature = createHmac("sha256", "test-secret").update(`POST${url}${body}${timestamp}`).digest("base64");
    return new NextRequest(url, { method: "POST", body, headers: { "x-hubspot-signature-v3": valid ? signature : "invalid", "x-hubspot-request-timestamp": timestamp } });
  }
  const event = { eventId: 42, portalId: 100, objectId: 1, occurredAt: 12345, subscriptionType: "contact.creation" };

  it("never persists or accesses credentials before Wix signature verification", async () => {
    expect((await wixWebhook(new NextRequest("https://sync.example.invalid/api/webhooks/wix", { method: "POST", body: "untrusted" }))).status).toBe(401);
    expect(m.persist).not.toHaveBeenCalled(); expect(m.admin).not.toHaveBeenCalled();
  });
  it("keeps the Wix event ID distinct from the contact entity ID", async () => {
    expect((await wixWebhook(wixRequest("wix.contacts.v4.contact_created", { id: "provider-event", entityId: "contact" }))).status).toBe(200);
    expect(m.persist).toHaveBeenCalledWith(expect.objectContaining({ eventId: "provider-event", correlationId: "contact", payload: expect.objectContaining({ instanceId: "site", contactId: "contact" }) }));
    expect(m.admin).not.toHaveBeenCalled();
  });
  it("persists an uninstall before atomically disabling the installation", async () => {
    expect((await wixWebhook(wixRequest("AppRemoved", {}))).status).toBe(200);
    expect(m.rpc).toHaveBeenCalledWith("apply_wix_removal", { p_event_id: "internal-event", p_instance_id: "site" });
    expect(m.persist.mock.invocationCallOrder[0]).toBeLessThan(m.rpc.mock.invocationCallOrder[0]);
  });
  it("rejects invalid HubSpot signatures before persistence", async () => {
    expect((await hubspotWebhook(hubspotRequest([event], false))).status).toBe(401);
    expect(m.persist).not.toHaveBeenCalled();
  });
  it.each([[null], [{ ...event, portalId: undefined }]])("rejects signed malformed HubSpot event batches", async (payload) => {
    expect((await hubspotWebhook(hubspotRequest(payload))).status).toBe(400);
    expect(m.persist).not.toHaveBeenCalled();
  });
  it("accepts documented classic eventType and subscriptionType envelopes", async () => {
    expect((await hubspotWebhook(hubspotRequest([event]))).status).toBe(202);
    const alternate = { ...event, subscriptionType: undefined, eventType: "contact.creation" };
    expect((await hubspotWebhook(hubspotRequest([alternate]))).status).toBe(202);
    expect(m.persist).toHaveBeenLastCalledWith(expect.objectContaining({ eventType: "contact.creation", correlationId: "1" }));
  });
  it("returns retryable errors when verified event persistence fails", async () => {
    m.persist.mockRejectedValue(new Error("simulated database failure"));
    expect((await hubspotWebhook(hubspotRequest([event]))).status).toBe(500);
    expect((await wixWebhook(wixRequest("wix.contacts.v4.contact_created", { id: "event", entityId: "contact" }))).status).toBe(500);
  });
});
