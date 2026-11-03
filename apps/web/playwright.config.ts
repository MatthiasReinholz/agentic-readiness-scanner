import { defineConfig, devices } from '@playwright/test';

const port = 8799;

/**
 * Browser regression suite for the hosted pages: layout invariants across widths and
 * themes, the scan-to-report handoff and the interactive knowledge base. It runs against
 * e2e/server.ts, which answers every scan from the recorded fixture stores.
 */
export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'tsx e2e/server.ts',
    url: `http://localhost:${port}/health`,
    env: { PORT: String(port) },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
