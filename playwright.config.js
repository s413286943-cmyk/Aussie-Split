import { defineConfig, devices } from "playwright/test";

const localPort = Number.parseInt(process.env.E2E_PORT || "4173", 10);
const localBaseUrl = process.env.E2E_BASE_URL || `http://127.0.0.1:${localPort}`;
const productionBaseUrl = process.env.E2E_PRODUCTION_URL || "https://aussie-split.vercel.app";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  outputDir: ".next/playwright/test-results",
  webServer: process.env.E2E_SKIP_WEB_SERVER ? undefined : {
    command: `AUSSIE_BUILD_RELEASE=e2e-local npm run build && AUSSIE_BUILD_RELEASE=e2e-local npm run start -- --hostname 127.0.0.1 --port ${localPort}`,
    url: localBaseUrl,
    timeout: 180_000,
    reuseExistingServer: false,
  },
  projects: [
    {
      name: "local-chrome",
      testIgnore: /production-smoke\.spec\.js/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: localBaseUrl,
        channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
      },
    },
    {
      name: "production-smoke",
      testMatch: /production-smoke\.spec\.js/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: productionBaseUrl,
        channel: process.env.PLAYWRIGHT_CHANNEL || "chrome",
        serviceWorkers: "block",
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
      },
    },
  ],
});
