import { test, expect, type Page } from "@playwright/test";

const userId = "00000000-0000-4000-8000-000000000001";
const tenantA = "10000000-0000-4000-8000-000000000001";
const tenantB = "10000000-0000-4000-8000-000000000002";
const wixId = "20000000-0000-4000-8000-000000000001";
const hubspotId = "20000000-0000-4000-8000-000000000002";
const pairId = "20000000-0000-4000-8000-000000000003";
async function fixture(page: Page) {
  const user = { id: userId, aud: "authenticated", role: "authenticated", email: "synthetic@example.invalid", email_confirmed_at: "2026-11-03T00:00:00Z", created_at: "2026-11-03T00:00:00Z", app_metadata: { provider: "email" }, user_metadata: {} };
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now()/1000)+3600, role: "authenticated" })).toString("base64url")}.synthetic-signature`;
  const state = { calls: [] as Array<{ path: string; tenant?: string; input: Record<string, unknown> }>, cancellations: 0 };
  await page.route("https://auth.example.invalid/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/signup")) return route.fulfill({ json: { user, session: null } });
    if (path.endsWith("/token")) {
      const body = route.request().postDataJSON();
      if (body.password === "incorrect") return route.fulfill({ status: 400, json: { error: "invalid_grant", error_description: "Invalid login credentials" } });
      return route.fulfill({ json: { access_token: token, token_type: "bearer", expires_in: 3600, refresh_token: "synthetic-refresh", user } });
    }
    return route.fulfill({ json: path.endsWith("/user") ? user : {} });
  });
  await page.route("https://app.hubspot.com/**", (route) => route.fulfill({ contentType: "text/html", body: '<a href="http://127.0.0.1:3210/customer?connection=hubspot-connected">Authorize synthetic customer portal</a>' }));
  await page.route("**/api/customer/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const input = request.postData() ? request.postDataJSON() as Record<string, unknown> : {};
    if (path.endsWith("/oauth/hubspot/cancel")) { state.cancellations++; return route.fulfill({ json: { cancelled: true } }); }
    expect(request.headers().authorization).toBe(`Bearer ${token}`);
    const tenant = request.headers()["x-tenant-id"];
    state.calls.push({ path, tenant, input });
    if (path.endsWith("/tenants")) return route.fulfill({ json: { tenants: [{ id: tenantA, name: "Organization A", role: "owner" }, { id: tenantB, name: "Organization B", role: "viewer" }] } });
    expect([tenantA, tenantB]).toContain(tenant);
    if (path.endsWith("/overview")) return route.fulfill({ json: { role: tenant === tenantA ? "owner" : "viewer", connections: [
      { id: wixId, provider: "wix", external_account_id: "synthetic-site", account_label: tenant === tenantA ? "A Wix site" : "B Wix site", scopes: [] },
      { id: hubspotId, provider: "hubspot", external_account_id: "100", account_label: "Synthetic portal", scopes: [] },
    ], pairs: [{ id: pairId, wix_connection_id: wixId, hubspot_connection_id: hubspotId, use_default_mappings: true }], mappings: [], recentEvents: [], recentActivity: [] } });
    if (path.endsWith("/fields")) return route.fulfill({ json: { wixFields: [], hubspotProperties: [] } });
    if (path.endsWith("/oauth/hubspot/start")) return route.fulfill({ json: { authorizationUrl: "https://app.hubspot.com/oauth/authorize?state=synthetic-customer-state" } });
    if (path.endsWith("/mappings")) return route.fulfill({ json: { count: (input.mappings as unknown[]).length } });
    if (path.endsWith("/sync/run")) return route.fulfill({ json: { status: "succeeded" } });
    if (path.endsWith("/connections/wix")) return route.fulfill({ json: { connected: true } });
    return route.fulfill({ status: 404, json: { error: "Unexpected fixture route" } });
  });
  return state;
}
async function signIn(page: Page) {
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.invalid");
  await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Account routing" })).toBeVisible();
}

test("customer sign-in rejects bad credentials, restores a session, and cancels consent on sign-out", async ({ page }) => {
  const state = await fixture(page); await page.goto("/customer");
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.invalid"); await page.getByLabel("Password", { exact: true }).fill("incorrect");
  await page.getByRole("button", { name: "Sign in", exact: true }).click(); await expect(page.getByText("Sign-in failed. Check your email and password.")).toBeVisible();
  await signIn(page); await page.reload(); await expect(page.getByRole("heading", { name: "Account routing" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click(); await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(state.cancellations).toBe(3);
});
test("customer signup requests email verification", async ({ page }) => {
  await fixture(page); await page.goto("/customer"); await page.getByRole("button", { name: "Create a customer account" }).click();
  await page.getByLabel("Email", { exact: true }).fill("synthetic@example.invalid"); await page.getByLabel("Password", { exact: true }).fill("synthetic-password");
  await page.getByRole("button", { name: "Create account", exact: true }).click(); await expect(page.getByText("Check your email to verify your account, then sign in.")).toBeVisible();
});
test("switching organizations scopes requests and disables mutations for viewers", async ({ page }) => {
  const state = await fixture(page); await page.goto("/customer"); await signIn(page);
  await expect(page.getByRole("option", { name: "A Wix site" })).toHaveCount(1);
  await page.getByLabel("Organization", { exact: true }).selectOption(tenantB);
  await expect(page.getByText("Read-only access")).toBeVisible(); await expect(page.getByRole("option", { name: "B Wix site" })).toHaveCount(1);
  await expect(page.getByRole("option", { name: "A Wix site" })).toHaveCount(0);
  for (const name of ["Connect HubSpot", "Pair selected accounts", "Save mappings"]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  expect(state.calls.filter((call) => call.path.endsWith("/overview")).map((call) => call.tenant)).toContain(tenantB);
});
test("customer mapping and manual sync include the selected organization and pair", async ({ page }) => {
  const state = await fixture(page); await page.goto("/customer"); await signIn(page);
  await page.getByRole("button", { name: "Save mappings", exact: true }).click(); await expect(page.getByText("Saved 4 field mappings.")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("synthetic-contact")); await page.getByRole("button", { name: /^Wix.*HubSpot$/ }).click();
  await expect(page.getByText("Sync result: succeeded")).toBeVisible();
  for (const suffix of ["/mappings", "/sync/run"]) expect(state.calls.find((call) => call.path.endsWith(suffix))).toMatchObject({ tenant: tenantA, input: { pairId } });
});
test("signed Wix context is removed from the address and sent only to the customer connection route", async ({ page }) => {
  const state = await fixture(page); await page.goto("/customer?instance=synthetic-signed-context"); await signIn(page);
  expect(new URL(page.url()).searchParams.has("instance")).toBe(false); await expect(page.getByLabel("Wix app instance ID")).toHaveCount(0);
  await page.getByRole("button", { name: "Connect Wix site", exact: true }).click();
  expect(state.calls.find((call) => call.path.endsWith("/connections/wix"))).toMatchObject({ tenant: tenantA, input: { instance: "synthetic-signed-context" } });
});
test("customer HubSpot consent returns to the customer workspace", async ({ page }) => {
  await fixture(page); await page.goto("/customer"); await signIn(page);
  await page.getByRole("button", { name: "Connect HubSpot", exact: true }).click(); await page.getByRole("link", { name: "Authorize synthetic customer portal" }).click();
  await expect(page.getByText("HubSpot connected successfully.")).toBeVisible();
});
