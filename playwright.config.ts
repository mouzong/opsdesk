import { defineConfig } from '@playwright/test';

const PORT = 4391;
const channel = process.env.PW_CHANNEL ?? 'chrome'; // use an installed Chrome/Edge: PW_CHANNEL=msedge. Empty string = Playwright's own Chromium.

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: channel || undefined,
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    acceptDownloads: true,
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning scripts/e2e-server.mjs',
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
  },
});
