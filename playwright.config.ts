import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * The sandbox ships a preinstalled Chromium whose revision may lag the one
 * bundled with `@playwright/test`. When that binary exists we point at it;
 * in CI (`npx playwright install chromium`) the path is absent and Playwright
 * resolves its own matching download.
 */
const PINNED_CHROMIUM =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ?? "/opt/pw-browsers/chromium";
const executablePath = existsSync(PINNED_CHROMIUM) ? PINNED_CHROMIUM : undefined;

/**
 * The E2E suite runs against a production build, never `next dev`. CI builds
 * once in its own step and sets E2E_NO_BUILD=1 so the build is not repeated.
 */
const webServerCommand =
  process.env.E2E_NO_BUILD === "1"
    ? "npm run start"
    : "npm run build && npm run start";

export default defineConfig({
  testDir: "e2e",
  // Evidence must be reproducible: a flaky pass is not a pass.
  retries: 0,
  reporter: "list",
  use: {
    baseURL: BASE_URL,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath } },
    },
  ],
  webServer: {
    command: webServerCommand,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
