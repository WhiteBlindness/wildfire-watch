import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the production OpenNext build under `wrangler
// dev`, with a synthetic FIRMS snapshot in local KV and every third-party host
// stubbed in the browser (see e2e/support/stubs.ts). They prove the app's own
// behaviour; they do not prove that NASA, CARTO, Esri or Open-Meteo are up.
const PORT = process.env.E2E_PORT ?? "8788";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    locale: "pt-PT",
    timezoneId: "Europe/Lisbon",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node e2e/support/start-server.mjs",
    url: `http://127.0.0.1:${PORT}/api/fires`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    stdout: "pipe",
    stderr: "pipe",
  },
});
