// Read-only verification against an explicitly designated staging project.
// No rows, credentials, response bodies or headers are printed.
const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};
if (process.env.ALLOW_STAGING_SMOKE !== 'true') throw new Error('Set ALLOW_STAGING_SMOKE=true only for an isolated staging project');
const base = new URL(required('SUPABASE_URL'));
if (base.protocol !== 'https:' || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('SUPABASE_URL must be an HTTPS origin');
}
const serverKey = required('SUPABASE_SECRET_KEY');
const publicKey = required('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
const tables = ['provider_connections', 'field_mappings', 'contact_links', 'webhook_events',
  'sync_audit_logs', 'integration_pairs', 'oauth_states', 'integration_leases', 'auth_rate_limits',
  'contact_creation_intents', 'tenants', 'tenant_memberships', 'customer_oauth_states'];
async function request(path, key) {
  // Supabase intentionally rejects secret keys with browser-like user agents.
  return fetch(new URL(path, base), { headers: { apikey: key,
    'User-Agent': 'wix-hubspot-staging-verification/1.0' }, signal: AbortSignal.timeout(20_000), redirect: 'error' });
}
const auth = await request('/auth/v1/settings', publicKey);
if (auth.status !== 200) throw new Error(`Public key validation failed: HTTP ${auth.status}`);
await auth.body?.cancel();
let index = 0;
const results = [];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (index < tables.length) {
    const table = tables[index++];
    const path = `/rest/v1/${table}?select=*&limit=0`;
    const server = await request(path, serverKey);
    const rows = await server.json();
    if (server.status !== 200 || !Array.isArray(rows) || rows.length !== 0) throw new Error(`Server access failed for ${table}: HTTP ${server.status}`);
    const browser = await request(path, publicKey);
    const denied = await browser.json();
    if (![401, 403].includes(browser.status) || denied.code !== '42501') throw new Error(`Browser permission denial failed for ${table}: HTTP ${browser.status}`);
    results.push({ table, server: server.status, browser: browser.status, permissionDenied: true });
  }
}));
console.log(JSON.stringify({ result: 'PASS', authKeyValidated: true,
  tables: results.sort((a,b) => a.table.localeCompare(b.table)), checks: results.length * 2 + 1 }, null, 2));
