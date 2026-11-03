import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("PostgreSQL migrations and queue", () => {
  const db = new PGlite();
  beforeAll(async () => {
    await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
    for (const name of readdirSync("supabase/migrations").filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(`supabase/migrations/${name}`, "utf8"));
    }
  }, 30_000);
  beforeEach(async () => {
    await db.exec("truncate public.contact_creation_intents, public.integration_pairs, public.field_mappings, public.contact_links, public.provider_connections, public.webhook_events, public.sync_audit_logs, public.oauth_states, public.integration_leases, public.auth_rate_limits;");
  });
  afterAll(async () => { await db.close(); });

  async function event(attempts = 0) {
    const result = await db.query<{ id: string }>(
      "insert into public.webhook_events(provider,event_type,idempotency_key,attempts) values ('wix','contact','test',$1) returning id", [attempts]);
    return result.rows[0].id;
  }
  async function claim(id: string) {
    return (await db.query<{ attempt: number | null }>("select public.claim_webhook_event_lease($1) as attempt", [id])).rows[0].attempt;
  }

  it("permits only one claim, recovers a stale lease, and increments its fencing token", async () => {
    const id = await event();
    expect(await claim(id)).toBe(1);
    expect(await claim(id)).toBeNull();
    await db.query("update public.webhook_events set processing_started_at = now() - interval '11 minutes' where id=$1", [id]);
    expect(await claim(id)).toBe(2);
  });

  it("does not reuse fencing versions when contention refunds a retry attempt", async () => {
    const id = await event();
    expect(await claim(id)).toBe(1);
    await db.query("update public.webhook_events set status='pending',attempts=attempts-1,processing_started_at=null where id=$1", [id]);
    expect(await claim(id)).toBe(2);
    expect((await db.query("select attempts,lease_version from public.webhook_events where id=$1", [id])).rows)
      .toEqual([{ attempts: 1, lease_version: 2 }]);
  });

  it("respects retry due dates and stops exhausted stale leases", async () => {
    const id = await event(4);
    await db.query("update public.webhook_events set status='failed', next_attempt_at=now()+interval '1 hour' where id=$1", [id]);
    expect(await claim(id)).toBeNull();
    await db.query("update public.webhook_events set next_attempt_at=now()-interval '1 minute' where id=$1", [id]);
    expect(await claim(id)).toBe(1);
    expect((await db.query<{ attempts: number }>("select attempts from public.webhook_events where id=$1", [id])).rows[0].attempts).toBe(5);
    await db.query("update public.webhook_events set processing_started_at=now()-interval '11 minutes' where id=$1", [id]);
    expect(await claim(id)).toBeNull();
    expect((await db.query("select status,error_code from public.webhook_events where id=$1", [id])).rows)
      .toEqual([{ status: "failed", error_code: "MAX_ATTEMPTS_EXCEEDED" }]);
  });

  it("rejects wrong provider pairs and replaces mappings transactionally", async () => {
    const result = await db.query<{ id: string; provider: string }>(
      "insert into public.provider_connections(provider,external_account_id) values ('wix','site'),('hubspot','portal') returning id,provider");
    const wix = result.rows.find((r) => r.provider === "wix")!.id;
    const hubspot = result.rows.find((r) => r.provider === "hubspot")!.id;
    await expect(db.query("insert into public.integration_pairs(wix_connection_id,hubspot_connection_id) values ($1,$2)", [hubspot, wix]))
      .rejects.toThrow(/Active Wix/);
    await db.query("insert into public.integration_pairs(wix_connection_id,hubspot_connection_id) values ($1,$2)", [wix, hubspot]);
    const mappings = [{ wixField: "info.name.first", hubspotProperty: "firstname", direction: "bidirectional" }];
    await db.query("select public.replace_field_mappings($1,$2,$3)", [wix, hubspot, JSON.stringify(mappings)]);
    await expect(db.query("select public.replace_field_mappings($1,$2,$3)", [wix, hubspot, JSON.stringify([{ ...mappings[0], direction: "invalid" }])]))
      .rejects.toThrow();
    expect((await db.query("select wix_field,hubspot_property from public.field_mappings")).rows)
      .toEqual([{ wix_field: "info.name.first", hubspot_property: "firstname" }]);
    await db.query("select public.replace_field_mappings($1,$2,'[]'::jsonb)", [wix, hubspot]);
    expect((await db.query("select * from public.field_mappings")).rows).toHaveLength(0);
    expect((await db.query("select use_default_mappings from public.integration_pairs")).rows)
      .toEqual([{ use_default_mappings: false }]);
  });

  it("blocks browser roles from integration tables and privileged queue functions", async () => {
    await db.exec("set role authenticated;");
    try {
      await expect(db.query("select * from public.provider_connections")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.integration_pairs")).rejects.toThrow(/permission denied/);
      await expect(db.query("select * from public.contact_creation_intents")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.claim_next_webhook_events(1)")).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.claim_webhook_event_lease(gen_random_uuid())")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("reset role;"); }
  });

  it("consumes OAuth state at most once and excludes expired states", async () => {
    await db.exec("insert into public.oauth_states(state_hash,expires_at) values ('fresh',now()+interval '10 minutes'),('expired',now()-interval '1 second');");
    const consume = () => db.query("delete from public.oauth_states where state_hash='fresh' and expires_at > now() returning state_hash");
    expect((await consume()).rows).toHaveLength(1);
    expect((await consume()).rows).toHaveLength(0);
    expect((await db.query("delete from public.oauth_states where state_hash='expired' and expires_at > now() returning state_hash")).rows).toHaveLength(0);
  });

  it("serializes sync leases across workers and recovers abandoned leases", async () => {
    const first = "00000000-0000-4000-8000-000000000001";
    const second = "00000000-0000-4000-8000-000000000002";
    const acquire = async (owner: string) => (await db.query<{ allowed: boolean }>("select public.acquire_integration_lease('site', $1) as allowed", [owner])).rows[0].allowed;
    expect(await acquire(first)).toBe(true);
    expect(await acquire(second)).toBe(false);
    await db.exec("update public.integration_leases set expires_at=now()-interval '1 second';");
    expect(await acquire(second)).toBe(true);
    expect((await db.query("delete from public.integration_leases where lease_key='site' and owner=$1 returning lease_key", [first])).rows).toHaveLength(0);
  });

  it("enforces a durable shared-account login budget", async () => {
    for (let i = 0; i < 10; i++) expect((await db.query<{ allowed: boolean }>("select public.allow_dashboard_login() as allowed")).rows[0].allowed).toBe(true);
    expect((await db.query<{ allowed: boolean }>("select public.allow_dashboard_login() as allowed")).rows[0].allowed).toBe(false);
    await db.exec("update public.auth_rate_limits set resets_at=now()-interval '1 second';");
    expect((await db.query<{ allowed: boolean }>("select public.allow_dashboard_login() as allowed")).rows[0].allowed).toBe(true);
  });

  it("creates an uninstall tombstone and never repeats removal after reconnect", async () => {
    const result = await db.query<{ id: string }>("insert into public.webhook_events(provider,event_type,idempotency_key) values ('wix','AppRemoved','removal') returning id");
    const id = result.rows[0].id;
    await db.query("select public.apply_wix_removal($1,'site')", [id]);
    expect((await db.query<{ disconnected_at: string | null }>("select disconnected_at from public.provider_connections where external_account_id='site'")).rows[0].disconnected_at).not.toBeNull();
    await db.exec("update public.provider_connections set disconnected_at=null,encrypted_access_token='new-token' where external_account_id='site';");
    await db.query("select public.apply_wix_removal($1,'site')", [id]);
    expect((await db.query("select disconnected_at,encrypted_access_token from public.provider_connections where external_account_id='site'")).rows)
      .toEqual([{ disconnected_at: null, encrypted_access_token: "new-token" }]);
  });

  it("uniquely reserves a creation and refuses changing its remembered destination", async () => {
    const rows = (await db.query<{ id: string; provider: string }>("insert into public.provider_connections(provider,external_account_id) values ('wix','site'),('hubspot','portal') returning id,provider")).rows;
    const wix = rows.find((row) => row.provider === "wix")!.id;
    const hubspot = rows.find((row) => row.provider === "hubspot")!.id;
    await db.query("insert into public.integration_pairs(wix_connection_id,hubspot_connection_id) values ($1,$2)", [wix, hubspot]);
    const sql = "insert into public.contact_creation_intents(wix_connection_id,hubspot_connection_id,source_provider,source_contact_id,encrypted_lookup_email) values ($1,$2,'wix','contact','encrypted') returning id";
    const id = (await db.query<{ id: string }>(sql, [wix, hubspot])).rows[0].id;
    await expect(db.query(sql, [wix, hubspot])).rejects.toThrow(/duplicate key/);
    const claim = () => db.query("update public.contact_creation_intents set state='creating',attempt_id=gen_random_uuid() where id=$1 and state='reserved' returning id", [id]);
    expect((await claim()).rows).toHaveLength(1);
    expect((await claim()).rows).toHaveLength(0);
    await db.query("select public.remember_contact_creation($1,'destination-a')", [id]);
    await expect(db.query("select public.remember_contact_creation($1,'destination-b')", [id])).rejects.toThrow(/identity conflict/);
    expect((await db.query("select destination_contact_id,state from public.contact_creation_intents where id=$1", [id])).rows)
      .toEqual([{ destination_contact_id: "destination-a", state: "completed" }]);
  });
});
