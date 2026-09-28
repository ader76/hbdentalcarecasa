import { defineConfig, devices } from "@playwright/test";

// Tests de bout en bout exécutés en local (navigateur headless, données fictives).
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: { baseURL: "http://127.0.0.1:3200", trace: "retain-on-failure", locale: "fr-FR", timezoneId: "Africa/Casablanca" },
  webServer: {
    command: "npx next start -p 3200 -H 127.0.0.1",
    url: "http://127.0.0.1:3200/login",
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "android", use: { ...devices["Pixel 7"] } },
    { name: "windows", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
});
