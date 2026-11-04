"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Connection = {
  id: string; provider: "wix" | "hubspot"; external_account_id: string;
  account_label: string | null; connected_at: string | null; scopes: string[];
  disconnected_at?: string | null;
};
type Mapping = {
  wixField: string; hubspotProperty: string;
  direction: "wix_to_hubspot" | "hubspot_to_wix" | "bidirectional";
  transform: "none" | "trim" | "lowercase" | "uppercase"; enabled: boolean; allowEmpty?: boolean;
};
type FieldOption = { value: string; label: string };
type Overview = {
  role?: "owner" | "admin" | "viewer";
  pairs: Array<{ id: string; wix_connection_id: string; hubspot_connection_id: string; use_default_mappings: boolean }>;
  connections: Connection[];
  mappings: Array<{ id: string; wix_connection_id: string; hubspot_connection_id: string; wix_field: string; hubspot_property: string; sync_direction: Mapping["direction"]; transform: Mapping["transform"]; enabled: boolean; allow_empty?: boolean }>;
  recentEvents: Array<{ id: string; provider: string; event_type: string; status: string; attempts: number; received_at: string; error_code: string | null }>;
  recentActivity: Array<{ id: string; provider: string; action: string; outcome: string; created_at: string }>;
};

const emptyMapping = (): Mapping => ({
  wixField: "info.name.first", hubspotProperty: "firstname",
  direction: "bidirectional", transform: "trim", enabled: true,
});

const DEFAULT_MAPPINGS: Mapping[] = [
  { wixField: "info.emails.items.0.email", hubspotProperty: "email", direction: "bidirectional", transform: "trim", enabled: true },
  { wixField: "info.name.first", hubspotProperty: "firstname", direction: "bidirectional", transform: "trim", enabled: true },
  { wixField: "info.name.last", hubspotProperty: "lastname", direction: "bidirectional", transform: "trim", enabled: true },
  { wixField: "info.phones.items.0.phone", hubspotProperty: "phone", direction: "bidirectional", transform: "trim", enabled: true },
];

export type CustomerDashboardAccess = {
  request: (path: string, init?: RequestInit) => Promise<Response>;
  logout: () => Promise<void>;
  connectHubSpot: () => Promise<void>;
  wixInstance: string;
  clearWixInstance: () => void;
  readOnly: boolean;
};

export default function IntegrationDashboard({ customer }: { customer?: CustomerDashboardAccess }) {
  const isCustomer = Boolean(customer);
  const [authenticated, setAuthenticated] = useState(isCustomer);
  const [checking, setChecking] = useState(!isCustomer);
  const [password, setPassword] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [wixFieldOptions, setWixFieldOptions] = useState<FieldOption[]>([]);
  const [hubspotPropertyOptions, setHubspotPropertyOptions] = useState<FieldOption[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [selectedWix, setSelectedWix] = useState("");
  const [selectedHubSpot, setSelectedHubSpot] = useState("");
  const customerRequest = customer?.request;
  const integrationRequest = useCallback((path: string, init?: RequestInit) => customerRequest
    ? customerRequest(path, init) : fetch(path === "/overview" ? "/api/admin/overview" : `/api${path}`, init), [customerRequest]);
  const readOnly = customer?.readOnly === true || overview?.role === "viewer";

  const loadDashboard = useCallback(async () => {
    const response = await integrationRequest("/overview", { cache: "no-store" });
    if (response.status === 401) { setAuthenticated(false); return; }
    if (!response.ok) { setNotice("Unable to load dashboard data."); return; }
    const data = await response.json() as Overview;
    data.connections = data.connections.filter((connection) => !connection.disconnected_at);
    setOverview(data);
    setSelectedWix((id) => data.connections.some((c) => c.id === id) ? id : data.connections.find((c) => c.provider === "wix")?.id || "");
    setSelectedHubSpot((id) => data.connections.some((c) => c.id === id) ? id : data.connections.find((c) => c.provider === "hubspot")?.id || "");
  }, [integrationRequest]);

  const selectedPair = overview?.pairs.find((pair) => pair.wix_connection_id === selectedWix && pair.hubspot_connection_id === selectedHubSpot);
  const selectedInstanceId = overview?.connections.find((c) => c.id === selectedWix)?.external_account_id;

  useEffect(() => {
    const rows = overview?.mappings.filter((item) => item.wix_connection_id === selectedWix &&
      item.hubspot_connection_id === selectedPair?.hubspot_connection_id) ?? [];
    setMappings(rows.length ? rows.map((item) => ({
      wixField: item.wix_field, hubspotProperty: item.hubspot_property,
      direction: item.sync_direction, transform: item.transform, enabled: item.enabled,
      allowEmpty: item.allow_empty === true,
    })) : selectedPair?.use_default_mappings === false ? [] : DEFAULT_MAPPINGS);
  }, [overview, selectedWix, selectedPair?.hubspot_connection_id, selectedPair?.use_default_mappings]);

  useEffect(() => {
    let active = true;
    setHubspotPropertyOptions([]);
    if (authenticated) integrationRequest(`/fields?connectionId=${encodeURIComponent(selectedPair?.hubspot_connection_id ?? selectedHubSpot)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Unable to discover provider fields");
        const fields = await response.json() as { wixFields: FieldOption[]; hubspotProperties: FieldOption[] };
        if (active) { setWixFieldOptions(fields.wixFields); setHubspotPropertyOptions(fields.hubspotProperties); }
      }).catch(() => { if (active) setNotice("Unable to discover provider fields."); });
    return () => { active = false; };
  }, [authenticated, selectedHubSpot, selectedPair?.hubspot_connection_id, integrationRequest]);

  async function pairConnections() {
    setBusy(true);
    try {
      const response = await integrationRequest("/connections/pair", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wixConnectionId: selectedWix, hubspotConnectionId: selectedHubSpot }) });
      setNotice(response.ok ? "Connections paired." : "Pairing failed. Check the selected active accounts and existing pair.");
      await loadDashboard();
    } catch { setNotice("Unable to pair connections."); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    let active = true;
    const connection = new URL(window.location.href).searchParams.get("connection");
    if (connection === "denied") setNotice("HubSpot authorization was denied. You can try connecting again.");
    if (connection === "hubspot-connected") setNotice("HubSpot connected successfully.");
    if (isCustomer) {
      setAuthenticated(true); setChecking(false);
      void loadDashboard().catch(() => { if (active) setNotice("Unable to load dashboard data."); });
      return () => { active = false; };
    }
    fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then(async (data: { authenticated?: boolean }) => {
        if (!active) return;
        setAuthenticated(Boolean(data.authenticated));
        if (data.authenticated) await loadDashboard();
      })
      .catch(() => { if (active) setNotice("Unable to check your session."); })
      .finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [loadDashboard, isCustomer]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }),
      });
      if (!response.ok) { setNotice("Incorrect password or dashboard login is not configured."); return; }
      setAuthenticated(true); setPassword(""); await loadDashboard();
    } catch { setNotice("Login failed. Please try again."); }
    finally { setBusy(false); }
  }

  async function logout() {
    try {
      if (customer) { await customer.logout(); return; }
      const response = await fetch("/api/admin/session", { method: "DELETE" });
      if (!response.ok) throw new Error("Logout failed");
      setAuthenticated(false); setOverview(null); setMappings([]);
    } catch { setNotice("Unable to sign out. Please try again."); }
  }

  async function connectWix(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response = await integrationRequest("/connections/wix", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(customer ? { instance: customer.wixInstance } : { instanceId }),
      });
      const data = await response.json();
      if (!response.ok) { setNotice(data.error ?? "Wix connection failed."); return; }
      setNotice("Wix site connected successfully."); setInstanceId(""); customer?.clearWixInstance(); await loadDashboard();
    } catch { setNotice("Wix connection failed."); }
    finally { setBusy(false); }
  }

  async function saveMappings() {
    setBusy(true); setNotice("");
    try {
      const response = await integrationRequest("/mappings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instanceId: selectedInstanceId, pairId: selectedPair?.id, mappings }),
      });
      const data = await response.json();
      if (!response.ok) { setNotice(data.error ?? "Unable to save mappings."); return; }
      setNotice(`Saved ${data.count} field mappings.`); await loadDashboard();
    } catch { setNotice("Unable to save mappings."); }
    finally { setBusy(false); }
  }

  async function disconnect(provider: "wix" | "hubspot") {
    const connection = overview?.connections.find((item) => item.id === (provider === "wix" ? selectedWix : selectedHubSpot));
    if (!connection || !window.confirm(`Disconnect ${provider === "wix" ? "Wix" : "HubSpot"} from this integration?`)) return;
    setBusy(true); setNotice("");
    try {
      const response = await integrationRequest(`/connections/${provider}/disconnect`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ externalAccountId: connection.external_account_id }),
      });
      const data = await response.json();
      setNotice(response.ok ? `${provider === "wix" ? "Wix" : "HubSpot"} disconnected.` : (data.error ?? "Disconnect failed."));
      await loadDashboard();
    } catch { setNotice("Disconnect failed."); }
    finally { setBusy(false); }
  }

  async function runSync(provider: "wix" | "hubspot") {
    const contactId = window.prompt(`Enter the ${provider === "wix" ? "Wix" : "HubSpot"} contact ID to synchronize:`);
    if (!contactId) return;
    setBusy(true); setNotice("");
    try {
      const response = await integrationRequest("/sync/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, contactId, instanceId: selectedInstanceId, pairId: selectedPair?.id }),
      });
      const data = await response.json();
      setNotice(response.ok ? `Sync result: ${data.status}` : (data.error ?? "Sync failed."));
      await loadDashboard();
    } catch { setNotice("Sync failed."); }
    finally { setBusy(false); }
  }

  if (checking) return <main className="shell"><p>Loading integration workspace…</p></main>;

  if (!authenticated) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <div className="brand-mark">W↔H</div>
          <p className="eyebrow">Integration workspace</p>
          <h1>Wix ↔ HubSpot Sync</h1>
          <p className="muted">Sign in to manage provider connections, field mappings and synchronization.</p>
          <form onSubmit={login} className="stack">
            <label htmlFor="password">Dashboard password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
            <button disabled={busy || !password}>{busy ? "Signing in…" : "Sign in"}</button>
          </form>
          {notice && <p className="notice">{notice}</p>}
        </section>
      </main>
    );
  }

  const wixConnected = Boolean(overview?.connections.some((item) => item.provider === "wix"));
  const hubspotConnected = Boolean(overview?.connections.some((item) => item.provider === "hubspot"));

  return (
    <main className="shell">
      <header className="topbar">
        <div><p className="eyebrow">Integration control center</p><h1>Wix ↔ HubSpot Sync</h1></div>
        <button className="button-quiet" onClick={logout}>Sign out</button>
      </header>
      {notice && <div className="notice" role="status">{notice}</div>}
      <datalist id="wix-field-options">{wixFieldOptions.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</datalist>
      <datalist id="hubspot-property-options">{hubspotPropertyOptions.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}</datalist>

      <section className="panel">
        <h2>Account routing</h2>
        <p className="muted">Select a Wix site to manage its mappings and manual sync. Pair each site with its intended HubSpot portal before syncing.</p>
        <label htmlFor="selected-wix">Wix site</label>
        <select id="selected-wix" value={selectedWix} onChange={(event) => setSelectedWix(event.target.value)}>
          <option value="">Select a site</option>
          {overview?.connections.filter((c) => c.provider === "wix").map((c) => <option key={c.id} value={c.id}>{c.account_label ?? c.external_account_id}</option>)}
        </select>
        <label htmlFor="selected-hubspot">HubSpot portal</label>
        <select id="selected-hubspot" value={selectedHubSpot} onChange={(event) => setSelectedHubSpot(event.target.value)}>
          <option value="">Select a portal</option>
          {overview?.connections.filter((c) => c.provider === "hubspot").map((c) => <option key={c.id} value={c.id}>{c.account_label ?? c.external_account_id}</option>)}
        </select>
        <p className="muted">{selectedPair ? `Routes to ${overview?.connections.find((c) => c.id === selectedPair.hubspot_connection_id)?.account_label ?? "paired portal (disconnected)"}` : "This site has no authorized destination."}</p>
        <button disabled={readOnly || busy || !selectedWix || !selectedHubSpot || Boolean(selectedPair)} onClick={pairConnections}>Pair selected accounts</button>
      </section>

      <section className="provider-grid">
        <article className="panel provider-card">
          <div className="provider-head"><div><span className="provider-icon wix-icon">W</span><h2>Wix</h2></div><span className={wixConnected ? "pill connected" : "pill"}>{wixConnected ? "Connected" : "Not connected"}</span></div>
          <p className="muted">{customer ? "Open this app from the Wix site dashboard as its owner, then connect it to the selected organization." : "Normally connects automatically from the signed Wix install webhook. Use the instance ID below only as a fallback."}</p>
          {wixConnected && <button className="button-quiet" disabled={busy || readOnly} onClick={() => disconnect("wix")}>Disconnect selected Wix site</button>}
          {(
            <form onSubmit={connectWix} className="stack">
              {!customer && <><label htmlFor="instanceId">Wix app instance ID</label><input id="instanceId" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} placeholder="Paste instance ID" required /></>}
              <button disabled={readOnly || busy || (customer ? !customer.wixInstance : !instanceId.trim())}>{busy ? "Connecting…" : "Connect Wix site"}</button>
            </form>
          )}
        </article>
        <article className="panel provider-card">
          <div className="provider-head"><div><span className="provider-icon hubspot-icon">H</span><h2>HubSpot</h2></div><span className={hubspotConnected ? "pill connected" : "pill"}>{hubspotConnected ? "Connected" : "Not connected"}</span></div>
          <p className="muted">Authorize access to contacts in the correct HubSpot portal.</p>
          {hubspotConnected && <button className="button-quiet" disabled={busy || readOnly} onClick={() => disconnect("hubspot")}>Disconnect selected HubSpot portal</button>}
          {customer ? <button disabled={busy || readOnly} onClick={async () => {
            setBusy(true); try { await customer.connectHubSpot(); } catch { setNotice("Unable to start HubSpot authorization."); } finally { setBusy(false); }
          }}>Connect HubSpot</button> : <a className="button-link" href="/api/oauth/hubspot/start">Connect HubSpot</a>}
        </article>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Configuration</p><h2>Field mapping</h2></div><button disabled={readOnly} className="button-secondary" onClick={() => setMappings((items) => [...items, emptyMapping()])}>Add mapping</button></div>
        <p className="muted">Custom mappings extend the default contact fields. Empty values are preserved unless you explicitly allow clearing a field.</p>
        <fieldset disabled={readOnly} className="mapping-list" style={{ border: 0, padding: 0, minWidth: 0 }}>
          {mappings.length === 0 && <p className="empty">No mappings configured yet. Add your first field mapping.</p>}
          {mappings.map((mapping, index) => (
            <div className="mapping-row" key={index}>
              <div><label htmlFor={`wix-field-${index}`}>Wix field</label><input id={`wix-field-${index}`} list="wix-field-options" value={mapping.wixField} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, wixField: e.target.value } : item))} placeholder="Choose or type a Wix field" /></div>
              <div><label htmlFor={`hubspot-field-${index}`}>HubSpot property</label><input id={`hubspot-field-${index}`} list="hubspot-property-options" value={mapping.hubspotProperty} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, hubspotProperty: e.target.value } : item))} placeholder="Choose or type a property" /></div>
              <div><label htmlFor={`direction-${index}`}>Direction</label><select id={`direction-${index}`} value={mapping.direction} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, direction: e.target.value as Mapping["direction"] } : item))}><option value="bidirectional">Both ways</option><option value="wix_to_hubspot">Wix → HubSpot</option><option value="hubspot_to_wix">HubSpot → Wix</option></select></div>
              <div><label htmlFor={`transform-${index}`}>Transform</label><select id={`transform-${index}`} value={mapping.transform} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, transform: e.target.value as Mapping["transform"] } : item))}><option value="none">None</option><option value="trim">Trim</option><option value="lowercase">Lowercase</option><option value="uppercase">Uppercase</option></select></div>
              <div><label htmlFor={`clear-${index}`}>Allow empty values</label><input id={`clear-${index}`} type="checkbox" checked={mapping.allowEmpty === true} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, allowEmpty: e.target.checked } : item))} /></div>
              <button className="remove-button" onClick={() => setMappings((items) => items.filter((_, i) => i !== index))} aria-label="Remove mapping">×</button>
            </div>
          ))}
        </fieldset>
        <div className="actions"><button disabled={readOnly || busy || !selectedPair} onClick={saveMappings}>{busy ? "Saving…" : "Save mappings"}</button><span className="muted small">{readOnly ? "Your role allows viewing only." : "Both providers must be connected before saving."}</span></div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Operations</p><h2>Manual synchronization</h2></div></div>
        <p className="muted">Run a one-contact sync to verify either direction before enabling automated traffic.</p>
        <div className="actions"><button className="button-secondary" disabled={readOnly || busy || !selectedPair} onClick={() => runSync("wix")}>Wix → HubSpot</button><button className="button-secondary" disabled={readOnly || busy || !selectedPair} onClick={() => runSync("hubspot")}>HubSpot → Wix</button></div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Monitoring</p><h2>Recent webhook events</h2></div></div>
        {overview?.recentEvents.length ? <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Event</th><th>Status</th><th>Attempts</th><th>Received</th></tr></thead><tbody>{overview.recentEvents.map((event) => <tr key={event.id}><td>{event.provider}</td><td>{event.event_type}</td><td><span className={`pill status-${event.status}`}>{event.status}</span></td><td>{event.attempts}</td><td>{new Date(event.received_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="empty">No webhook events received yet.</p>}
      </section>

      <footer className="footer-note">Provider credentials are stored server-side. Wix/HubSpot OAuth tokens and contact payloads are never displayed here.</footer>
    </main>
  );
}
