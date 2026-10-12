import { defineConfig } from '@playwright/test';

/**
 * Browser tests. By default Playwright's own Chromium is used
 * (`npx playwright install chromium`). Set E2E_CHANNEL=msedge or chrome to use
 * an installed browser instead, or E2E_CHROMIUM_PATH for a custom binary.
 */
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3100';
const port = new URL(baseURL).port || '3000';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
    ...(process.env.E2E_CHROMIUM_PATH
      ? { channel: 'chromium' as const, launchOptions: { executablePath: process.env.E2E_CHROMIUM_PATH } }
      : {}),
  },
  webServer: process.env.E2E_NO_SERVER ? undefined : {
    // Runs the production build (`npm run build` first) on its own port and data directory.
    command: `npx next start -p ${port}`,
    env: { DATA_DIR: '.data-e2e' },
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
