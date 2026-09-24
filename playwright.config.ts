import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    // Normally left unset: `npx playwright install chromium` provides the browser.
    // Set E2E_CHROMIUM_PATH in environments where Chromium is preinstalled.
    // `channel: 'chromium'` is required alongside executablePath: without it,
    // headless runs use the separate chrome-headless-shell download.
    ...(process.env.E2E_CHROMIUM_PATH
      ? { channel: 'chromium' as const, launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } }
      : {}),
  },
  webServer: process.env.E2E_NO_SERVER ? undefined : {
    command: 'npm start',
    url: 'http://127.0.0.1:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
