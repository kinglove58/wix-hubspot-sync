import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);
const reservation = createServer();
reservation.listen(0, "127.0.0.1");
await once(reservation, "listening");
const port = reservation.address().port;
await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", String(port)], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let startupOutput = "";
let startupError;
child.on("error", (error) => { startupError = error; });
for (const stream of [child.stdout, child.stderr]) stream.on("data", (data) => { startupOutput = (startupOutput + data.toString()).slice(-4096); });
const base = `http://127.0.0.1:${port}`;

try {
  let ready = false;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (startupError) throw startupError;
    if (child.exitCode !== null) throw new Error(`Production server exited: ${startupOutput}`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      const body = await response.json();
      ready = response.status === 200 && body.service === "wix-hubspot-sync";
      if (ready) break;
    } catch { /* Retry connection failures while the owned server starts. */ }
    await delay(200);
  }
  if (!ready) throw new Error(`Production server did not become ready: ${startupOutput}`);

  const checks = [
    ["/api/health", "GET", [200]],
    ["/api/admin/session", "GET", [200]],
    ["/api/health/ready", "GET", [401]],
    ["/api/mappings", "GET", [401]],
    ["/api/sync/run", "POST", [401]],
    ["/api/connections/pair", "POST", [401]],
    ["/api/worker/dispatch", "POST", [401, 503]],
  ];
  for (const [path, method, statuses] of checks) {
    const response = await fetch(`${base}${path}`, { method, signal: AbortSignal.timeout(5000) });
    if (!statuses.includes(response.status)) throw new Error(`${method} ${path}: unexpected status ${response.status}`);
    if (!response.headers.get("cache-control")?.includes("no-store")) throw new Error(`${path}: missing no-store header`);
    if (path === "/api/admin/session" && (await response.json()).authenticated !== false) throw new Error("Anonymous session unexpectedly authenticated");
    console.log(`${method} ${path}: ${response.status}`);
  }
  console.log("Production HTTP smoke checks passed.");
} finally {
  if (child.exitCode === null) {
    const stopped = once(child, "exit");
    child.kill("SIGTERM");
    await Promise.race([stopped, delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
}
