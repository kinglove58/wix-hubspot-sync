import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: "http://127.0.0.1:3210", headless: true, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { command: "npm run start -- --hostname 127.0.0.1 --port 3210", url: "http://127.0.0.1:3210/api/health", reuseExistingServer: false, timeout: 60_000,
    env: { CUSTOMER_ACCESS_ENABLED: "true", SUPABASE_URL: "https://auth.example.invalid", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_synthetic_customer_browser_key" },
  },
});
