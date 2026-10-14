import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChromium = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: 'http://localhost:4173/Occupency-cert/',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    launchOptions: existsSync(localChromium) ? { executablePath: localChromium } : {},
  },
  webServer: {
    command: 'npm run e2e:serve',
    url: 'http://localhost:4173/Occupency-cert/',
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
