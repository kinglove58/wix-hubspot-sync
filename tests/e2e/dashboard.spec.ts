import { test, expect, type Page } from "@playwright/test";

const wixId = "00000000-0000-4000-8000-000000000001";
const hubspotId = "00000000-0000-4000-8000-000000000002";
const pairId = "00000000-0000-4000-8000-000000000003";
const wix = { id: wixId, provider: "wix", external_account_id: "synthetic-instance", account_label: "Test Wix site", scopes: [] };
const hubspot = { id: hubspotId, provider: "hubspot", external_account_id: "100", account_label: "Test portal 100", scopes: [] };

async function browserFixture(page: Page, connected = true) {
  const state = {
    authenticated: false, denied: false,
    connections: connected ? [wix, hubspot] : [] as Array<typeof wix>,
    pairs: connected ? [{ id: pairId, wix_connection_id: wixId, hubspot_connection_id: hubspotId, use_default_mappings: true }] : [],
    mappings: [] as Array<Record<string, unknown>>,
    lastSync: null as Record<string, unknown> | null,
  };
  await page.route("https://app.hubspot.com/**", (route) => route.fulfill({ contentType: "text/html", body: '<a href="http://127.0.0.1:3210/api/oauth/hubspot/callback?code=synthetic-code&state=synthetic-state">Authorize synthetic portal</a>' }));
  await page.route("**/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const input = request.postData() ? request.postDataJSON() as Record<string, unknown> : {};
    if (path === "/api/admin/session") {
      if (request.method() === "POST") {
        state.authenticated = input.password === "synthetic-dashboard-password";
        return route.fulfill({ status: state.authenticated ? 200 : 401, json: { authenticated: state.authenticated } });
      }
      if (request.method() === "DELETE") state.authenticated = false;
      return route.fulfill({ json: { authenticated: state.authenticated } });
    }
    if (path === "/api/oauth/hubspot/start") return route.fulfill({ status: 302, headers: { location: "https://app.hubspot.com/oauth/authorize?state=synthetic-state" } });
    if (path === "/api/oauth/hubspot/callback") {
      if (!state.denied && !state.connections.some((c) => c.provider === "hubspot")) state.connections.push(hubspot);
      return route.fulfill({ status: 302, headers: { location: state.denied ? "/?connection=denied" : "/?connection=hubspot-connected" } });
    }
    if (path === "/api/admin/overview") return route.fulfill({ json: { connections: state.connections, pairs: state.pairs, mappings: state.mappings,
      recentEvents: [{ id: "failed-event", provider: "wix", event_type: "contact_updated", status: "failed", attempts: 5, received_at: "2026-01-01T10:00:00Z", error_code: "CONTACT_RECONCILIATION_REQUIRED" }], recentActivity: [] } });
    if (path === "/api/fields") return route.fulfill({ json: { wixFields: [{ value: "info.jobTitle", label: "Job title" }], hubspotProperties: [{ value: "jobtitle", label: "Job title" }] } });
    if (path === "/api/connections/wix") {
      if (!state.connections.some((c) => c.provider === "wix")) state.connections.push(wix);
      return route.fulfill({ json: { connected: true } });
    }
    if (path === "/api/connections/pair") { state.pairs = [{ id: pairId, wix_connection_id: wixId, hubspot_connection_id: hubspotId, use_default_mappings: true }]; return route.fulfill({ status: 201, json: { paired: true } }); }
    if (path.endsWith("/disconnect")) { const provider = path.split("/")[3]; state.connections = state.connections.filter((c) => c.provider !== provider); return route.fulfill({ json: { disconnected: true } }); }
    if (path === "/api/mappings") {
      state.mappings = (input.mappings as Array<Record<string, unknown>>).map((m, index) => ({ id: String(index), wix_connection_id: wixId, hubspot_connection_id: hubspotId,
        wix_field: m.wixField, hubspot_property: m.hubspotProperty, sync_direction: m.direction, transform: m.transform, enabled: m.enabled, allow_empty: m.allowEmpty }));
      return route.fulfill({ json: { count: state.mappings.length } });
    }
    if (path === "/api/sync/run") { state.lastSync = input; return route.fulfill({ json: { status: "succeeded" } }); }
    return route.fulfill({ status: 404, json: { error: "Unexpected fixture route" } });
  });
  await page.goto("/");
  return state;
}
async function login(page: Page) {
  await page.getByLabel("Dashboard password").fill("synthetic-dashboard-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account routing" })).toBeVisible();
}

test("opens the login page, rejects an incorrect password, and signs out", async ({ page }) => {
  await browserFixture(page);
  await page.getByLabel("Dashboard password").fill("wrong"); await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByText(/Incorrect password/)).toBeVisible();
  await login(page); await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByLabel("Dashboard password")).toBeVisible();
});
test("connects HubSpot through a synthetic provider callback, connects Wix, and pairs accounts", async ({ page }) => {
  const state = await browserFixture(page, false); await login(page);
  await page.getByRole("link", { name: "Connect HubSpot", exact: true }).click();
  await page.getByRole("link", { name: "Authorize synthetic portal" }).click();
  await expect(page.getByText("HubSpot connected successfully.")).toBeVisible();
  await page.getByLabel("Wix app instance ID").fill("synthetic-instance"); await page.getByRole("button", { name: "Connect Wix site", exact: true }).click();
  await page.getByRole("button", { name: "Pair selected accounts" }).click();
  await expect(page.getByText("Connections paired.")).toBeVisible(); expect(state.pairs).toHaveLength(1);
});
test("shows OAuth denial without treating it as a successful connection", async ({ page }) => {
  const state = await browserFixture(page, false); state.denied = true; await login(page);
  await page.getByRole("link", { name: "Connect HubSpot", exact: true }).click(); await page.getByRole("link", { name: "Authorize synthetic portal" }).click();
  await expect(page.getByText(/HubSpot authorization was denied/)).toBeVisible(); expect(state.connections).toHaveLength(0);
});
test("saves a partial custom mapping with safe empty-value policy and explicit pair identity", async ({ page }) => {
  const state = await browserFixture(page); await login(page);
  await page.getByRole("button", { name: "Add mapping" }).click();
  await page.getByLabel("Wix field", { exact: true }).last().fill("info.jobTitle");
  await page.getByLabel("HubSpot property", { exact: true }).last().fill("jobtitle");
  await page.getByRole("button", { name: "Save mappings", exact: true }).click();
  await expect(page.getByText("Saved 5 field mappings.")).toBeVisible();
  expect(state.mappings.at(-1)?.allow_empty).not.toBe(true);
});
test("runs a contact sync for the selected pair and displays failed webhook status", async ({ page }) => {
  const state = await browserFixture(page); await login(page);
  await expect(page.getByRole("cell", { name: "failed", exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("synthetic-contact"));
  await page.getByRole("button", { name: /^Wix.*HubSpot$/ }).click();
  await expect(page.getByText("Sync result: succeeded")).toBeVisible();
  expect(state.lastSync).toMatchObject({ pairId, instanceId: "synthetic-instance", contactId: "synthetic-contact" });
});
test("disconnects and reconnects a provider while preserving its pair", async ({ page }) => {
  const state = await browserFixture(page); await login(page);
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "Disconnect selected HubSpot portal" }).click();
  await expect(page.getByText("HubSpot disconnected.")).toBeVisible(); expect(state.pairs).toHaveLength(1);
  await page.getByRole("link", { name: "Connect HubSpot", exact: true }).click(); await page.getByRole("link", { name: "Authorize synthetic portal" }).click();
  await expect(page.getByText("HubSpot connected successfully.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect selected HubSpot portal" })).toBeVisible();
});
