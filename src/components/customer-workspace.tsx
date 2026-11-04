"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient, type Session } from "@supabase/supabase-js";
import IntegrationDashboard, { type CustomerDashboardAccess } from "@/components/integration-dashboard";
import type { CustomerPublicConfig } from "@/lib/security/customer-config";

type Organization = { id: string; name: string; role: "owner" | "admin" | "viewer" };

export default function CustomerWorkspace({ config }: { config: CustomerPublicConfig }) {
  const client = useMemo(() => config.enabled && typeof window !== "undefined" ? createClient(config.url, config.publishableKey, {
    auth: { flowType: "pkce", storageKey: "wixhub-customer-auth", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(15_000), ...(init?.signal ? [init.signal] : [])]) }) },
  }) : null, [config]);
  const [session, setSession] = useState<Session | null>(null);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState(""); const [password, setPassword] = useState("");
  const [signUp, setSignUp] = useState(false); const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selected, setSelected] = useState(""); const [organizationName, setOrganizationName] = useState("");
  const [wixInstance, setWixInstance] = useState("");
  const currentUser = useRef<string | null>(null);

  useEffect(() => {
    const url = new URL(window.location.href);
    const proof = url.searchParams.get("instance") ?? url.searchParams.get("signedInstance");
    if (proof) {
      setWixInstance(proof); url.searchParams.delete("instance"); url.searchParams.delete("signedInstance");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, []);

  useEffect(() => {
    if (!client) return;
    let active = true; let receivedEvent = false;
    const receive = (next: Session | null) => {
      if (!active) return;
      currentUser.current = next?.user.id ?? null;
      setSession(next); setChecking(false);
      if (!next) { setOrganizations([]); setSelected(""); }
    };
    const { data: listener } = client.auth.onAuthStateChange((_event, next) => { receivedEvent = true; receive(next); });
    void client.auth.getSession().then(({ data, error }) => {
      if (!receivedEvent) { receive(data.session); if (error) setNotice("Unable to restore your sign-in. Please sign in again."); }
    }).catch(() => { if (active && !receivedEvent) { receive(null); setNotice("Unable to restore your sign-in. Please sign in again."); } });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client]);

  const authenticatedRequest = useCallback(async (path: string, init: RequestInit = {}, tenantId?: string) => {
    if (!client) throw new Error("Customer sign-in unavailable");
    const { data, error } = await client.auth.getSession();
    if (error || !data.session) throw new Error("Sign in required");
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${data.session.access_token}`);
    if (tenantId) headers.set("x-tenant-id", tenantId);
    return fetch(`/api/customer${path}`, { ...init, headers, cache: "no-store" });
  }, [client]);

  const loadOrganizations = useCallback(async (preferred?: string) => {
    const expectedUser = currentUser.current;
    const response = await authenticatedRequest("/tenants");
    if (!response.ok) throw new Error("Organization access unavailable");
    const data = await response.json() as { tenants: Organization[] };
    if (currentUser.current !== expectedUser) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem(`wixhub-organization:${expectedUser}`); } catch { /* Browser storage is optional. */ }
    const requested = preferred ?? new URL(window.location.href).searchParams.get("tenant") ?? saved;
    setOrganizations(data.tenants);
    setSelected((previous) => data.tenants.some((tenant) => tenant.id === requested) ? requested! : data.tenants.some((tenant) => tenant.id === previous) ? previous : data.tenants[0]?.id ?? "");
  }, [authenticatedRequest]);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    void loadOrganizations().catch(() => setNotice("Unable to load your organizations. Verify your account or sign in again."));
  }, [userId, loadOrganizations]);
  useEffect(() => {
    if (userId && selected) {
      try { localStorage.setItem(`wixhub-organization:${userId}`, selected); } catch { /* Browser storage is optional. */ }
    }
  }, [selected, userId]);

  async function cancelPendingConsent() {
    const response = await fetch("/api/customer/oauth/hubspot/cancel", { method: "POST" });
    if (!response.ok) throw new Error("Unable to cancel pending authorization");
  }

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!client) return;
    setBusy(true); setNotice("");
    try {
      await cancelPendingConsent();
      const result = signUp ? await client.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}/customer` } }) : await client.auth.signInWithPassword({ email, password });
      if (result.error) { setNotice(signUp ? "Unable to create an account. Check your details and try again." : "Sign-in failed. Check your email and password."); return; }
      setPassword("");
      if (signUp && !result.data.session) setNotice("Check your email to verify your account, then sign in.");
    } catch { setNotice("Unable to sign in right now. Please try again."); }
    finally { setBusy(false); }
  }

  const logout = useCallback(async () => {
    if (!client) return;
    const cancellation = await fetch("/api/customer/oauth/hubspot/cancel", { method: "POST" });
    if (!cancellation.ok) throw new Error("Unable to cancel pending authorization before sign-out");
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw new Error("Unable to complete sign-out");
    currentUser.current = null; setSession(null); setOrganizations([]); setSelected(""); setNotice(""); setWixInstance("");
  }, [client]);

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response = await authenticatedRequest("/tenants", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: organizationName }) });
      if (!response.ok) throw new Error("Organization creation failed");
      const data = await response.json() as { id: string };
      setOrganizationName(""); await loadOrganizations(data.id);
    } catch { setNotice("Unable to create your organization. Verify your account and try again."); }
    finally { setBusy(false); }
  }

  const tenantRequest = useCallback((path: string, init?: RequestInit) => authenticatedRequest(path, init, selected), [authenticatedRequest, selected]);
  const connectHubSpot = useCallback(async () => {
    const response = await tenantRequest("/oauth/hubspot/start", { method: "POST" });
    if (!response.ok) throw new Error("Authorization unavailable");
    const { authorizationUrl } = await response.json() as { authorizationUrl: string };
    const url = new URL(authorizationUrl);
    if (url.protocol !== "https:" || url.hostname !== "app.hubspot.com" || url.pathname !== "/oauth/authorize") throw new Error("Invalid authorization destination");
    window.location.assign(url.toString());
  }, [tenantRequest]);
  const clearWixInstance = useCallback(() => setWixInstance(""), []);
  const organization = organizations.find((tenant) => tenant.id === selected);
  const access = useMemo<CustomerDashboardAccess>(() => ({ request: tenantRequest, logout, connectHubSpot, wixInstance, clearWixInstance, readOnly: organization?.role === "viewer" }), [tenantRequest, logout, connectHubSpot, wixInstance, clearWixInstance, organization?.role]);

  if (!config.enabled) return <main className="shell"><h1>Customer workspace</h1><p>Customer access is unavailable. Contact the integration operator.</p></main>;
  if (checking) return <main className="shell"><p>Loading your workspace…</p></main>;
  if (!session) return <main className="login-shell"><section className="login-card">
    <p className="eyebrow">Customer workspace</p><h1>Wix ↔ HubSpot Sync</h1>
    <form className="stack" onSubmit={signIn}>
      <label htmlFor="customer-email">Email</label><input id="customer-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      <label htmlFor="customer-password">Password</label><input id="customer-password" type="password" autoComplete={signUp ? "new-password" : "current-password"} minLength={signUp ? 12 : undefined} value={password} onChange={(event) => setPassword(event.target.value)} required />
      <button disabled={busy}>{signUp ? "Create account" : "Sign in"}</button>
      <button className="button-quiet" type="button" disabled={busy} onClick={() => { setSignUp(!signUp); setNotice(""); }}>{signUp ? "Use an existing account" : "Create a customer account"}</button>
    </form>{notice && <p role="status" className="notice">{notice}</p>}
  </section></main>;
  return <>
    <section className="shell">
      <h2>Your organization</h2>
      <label htmlFor="customer-organization">Organization</label><select id="customer-organization" value={selected} disabled={busy} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Select an organization</option>{organizations.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}
      </select>
      {organization && <p className="muted">{organization.role === "viewer" ? "Read-only access" : "You can manage integrations for this organization."}</p>}
      <form onSubmit={createOrganization} className="actions"><label htmlFor="organization-name">New organization name</label><input id="organization-name" value={organizationName} maxLength={120} onChange={(event) => setOrganizationName(event.target.value)} required /><button disabled={busy || !organizationName.trim()}>Create organization</button></form>
      {!organization && <button onClick={() => { void logout().catch(() => setNotice("Unable to sign out. Please try again.")); }}>Sign out</button>}
      {notice && <p role="status" className="notice">{notice}</p>}
    </section>
    {organization && <IntegrationDashboard key={`${session.user.id}:${organization.id}`} customer={access} />}
  </>;
}
