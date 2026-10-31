"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Connection = {
  id: string; provider: "wix" | "hubspot"; external_account_id: string;
  account_label: string | null; connected_at: string | null; scopes: string[];
};
type Mapping = {
  wixField: string; hubspotProperty: string;
  direction: "wix_to_hubspot" | "hubspot_to_wix" | "bidirectional";
  transform: "none" | "trim" | "lowercase" | "uppercase"; enabled: boolean;
};
type Overview = {
  connections: Connection[];
  mappings: Array<{ id: string; wix_field: string; hubspot_property: string; sync_direction: Mapping["direction"]; transform: Mapping["transform"]; enabled: boolean }>;
  recentEvents: Array<{ id: string; provider: string; event_type: string; status: string; attempts: number; received_at: string; error_code: string | null }>;
  recentActivity: Array<{ id: string; provider: string; action: string; outcome: string; created_at: string }>;
};

const emptyMapping = (): Mapping => ({
  wixField: "info.name.first", hubspotProperty: "firstname",
  direction: "bidirectional", transform: "trim", enabled: true,
});

export default function HomePage() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [overview, setOverview] = useState<Overview | null>(null);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const loadDashboard = useCallback(async () => {
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    if (response.status === 401) { setAuthenticated(false); return; }
    if (!response.ok) { setNotice("Unable to load dashboard data."); return; }
    const data = await response.json() as Overview;
    setOverview(data);
    setMappings(data.mappings.map((item) => ({
      wixField: item.wix_field, hubspotProperty: item.hubspot_property,
      direction: item.sync_direction, transform: item.transform, enabled: item.enabled,
    })));
  }, []);

  useEffect(() => {
    let active = true;
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
  }, [loadDashboard]);

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
    await fetch("/api/admin/session", { method: "DELETE" });
    setAuthenticated(false); setOverview(null); setMappings([]);
  }

  async function connectWix(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/connections/wix", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ instanceId }),
      });
      const data = await response.json();
      if (!response.ok) { setNotice(data.error ?? "Wix connection failed."); return; }
      setNotice("Wix site connected successfully."); setInstanceId(""); await loadDashboard();
    } catch { setNotice("Wix connection failed."); }
    finally { setBusy(false); }
  }

  async function saveMappings() {
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/mappings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      const data = await response.json();
      if (!response.ok) { setNotice(data.error ?? "Unable to save mappings."); return; }
      setNotice(`Saved ${data.count} field mappings.`); await loadDashboard();
    } catch { setNotice("Unable to save mappings."); }
    finally { setBusy(false); }
  }

  async function runSync(provider: "wix" | "hubspot") {
    const contactId = window.prompt(`Enter the ${provider === "wix" ? "Wix" : "HubSpot"} contact ID to synchronize:`);
    if (!contactId) return;
    setBusy(true); setNotice("");
    try {
      const response = await fetch("/api/sync/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, contactId, instanceId: overview?.connections.find((c) => c.provider === "wix")?.external_account_id }),
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

      <section className="provider-grid">
        <article className="panel provider-card">
          <div className="provider-head"><div><span className="provider-icon wix-icon">W</span><h2>Wix</h2></div><span className={wixConnected ? "pill connected" : "pill"}>{wixConnected ? "Connected" : "Not connected"}</span></div>
          <p className="muted">Connect the Wix app instance installed on your test site.</p>
          <form onSubmit={connectWix} className="stack">
            <label htmlFor="instanceId">Wix app instance ID</label>
            <input id="instanceId" value={instanceId} onChange={(e) => setInstanceId(e.target.value)} placeholder="Paste instance ID" required />
            <button disabled={busy || !instanceId.trim()}>{busy ? "Connecting…" : "Connect Wix site"}</button>
          </form>
        </article>
        <article className="panel provider-card">
          <div className="provider-head"><div><span className="provider-icon hubspot-icon">H</span><h2>HubSpot</h2></div><span className={hubspotConnected ? "pill connected" : "pill"}>{hubspotConnected ? "Connected" : "Not connected"}</span></div>
          <p className="muted">Authorize access to contacts in the correct HubSpot portal.</p>
          <a className="button-link" href="/api/oauth/hubspot/start">Connect HubSpot</a>
        </article>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Configuration</p><h2>Field mapping</h2></div><button className="button-secondary" onClick={() => setMappings((items) => [...items, emptyMapping()])}>Add mapping</button></div>
        <p className="muted">Map Wix contact fields to HubSpot properties. Use dotted paths for nested Wix fields.</p>
        <div className="mapping-list">
          {mappings.length === 0 && <p className="empty">No mappings configured yet. Add your first field mapping.</p>}
          {mappings.map((mapping, index) => (
            <div className="mapping-row" key={index}>
              <div><label>Wix field</label><input value={mapping.wixField} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, wixField: e.target.value } : item))} placeholder="info.name.first" /></div>
              <div><label>HubSpot property</label><input value={mapping.hubspotProperty} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, hubspotProperty: e.target.value } : item))} placeholder="firstname" /></div>
              <div><label>Direction</label><select value={mapping.direction} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, direction: e.target.value as Mapping["direction"] } : item))}><option value="bidirectional">Both ways</option><option value="wix_to_hubspot">Wix → HubSpot</option><option value="hubspot_to_wix">HubSpot → Wix</option></select></div>
              <div><label>Transform</label><select value={mapping.transform} onChange={(e) => setMappings((items) => items.map((item, i) => i === index ? { ...item, transform: e.target.value as Mapping["transform"] } : item))}><option value="none">None</option><option value="trim">Trim</option><option value="lowercase">Lowercase</option><option value="uppercase">Uppercase</option></select></div>
              <button className="remove-button" onClick={() => setMappings((items) => items.filter((_, i) => i !== index))} aria-label="Remove mapping">×</button>
            </div>
          ))}
        </div>
        <div className="actions"><button disabled={busy || !wixConnected || !hubspotConnected} onClick={saveMappings}>{busy ? "Saving…" : "Save mappings"}</button><span className="muted small">Both providers must be connected before saving.</span></div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Operations</p><h2>Manual synchronization</h2></div></div>
        <p className="muted">Run a one-contact sync to verify either direction before enabling automated traffic.</p>
        <div className="actions"><button className="button-secondary" disabled={busy || !wixConnected || !hubspotConnected} onClick={() => runSync("wix")}>Wix → HubSpot</button><button className="button-secondary" disabled={busy || !wixConnected || !hubspotConnected} onClick={() => runSync("hubspot")}>HubSpot → Wix</button></div>
      </section>

      <section className="panel">
        <div className="section-heading"><div><p className="eyebrow">Monitoring</p><h2>Recent webhook events</h2></div></div>
        {overview?.recentEvents.length ? <div className="table-wrap"><table><thead><tr><th>Provider</th><th>Event</th><th>Status</th><th>Attempts</th><th>Received</th></tr></thead><tbody>{overview.recentEvents.map((event) => <tr key={event.id}><td>{event.provider}</td><td>{event.event_type}</td><td><span className={`pill status-${event.status}`}>{event.status}</span></td><td>{event.attempts}</td><td>{new Date(event.received_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="empty">No webhook events received yet.</p>}
      </section>

      <footer className="footer-note">Credentials are stored server-side. OAuth tokens and contact payloads are never displayed in this dashboard.</footer>
    </main>
  );
}
